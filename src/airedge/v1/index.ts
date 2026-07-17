import pino from 'pino'
import { mqtt_topics } from '../../constants'
import { AirEdgeMqttClient } from '../../core/mqtt'
import { AirEdgeDeviceOfflineError, AirEdgeError } from '../../errors'
import type { AirEdgeV1Configuration } from '../../types/airedge/v1'
import type { V1Configuration } from '../../types/airedge/v1/configuration'
import { buildV1PublishTopic, buildV1SubscribeTopic } from '../../utils/mqtt'

export class AirEdgeV1 {
  private _configuration: AirEdgeV1Configuration
  private _mqttClient?: AirEdgeMqttClient
  private _deviceConfiguration?: V1Configuration
  private _pendingConfiguration?: V1Configuration
  private _configurationUpdateAvailable = false
  private _configUpdateCallback?: () => void
  private _configSettingResolve?: (config: V1Configuration) => void
  private _deviceData?: unknown
  private _dataPollingTimer?: ReturnType<typeof setInterval>
  private _onDataCallback?: (data: unknown) => void
  private _logger = pino()

  public get configuration(): AirEdgeV1Configuration {
    return this._configuration
  }

  /** Configurazione attiva ricevuta dal dispositivo, disponibile dopo una connessione riuscita. */
  public get deviceConfiguration(): V1Configuration | undefined {
    return this._deviceConfiguration
  }

  /** Ultimi dati ricevuti dal dispositivo, aggiornati ad ogni ciclo di polling. */
  public get deviceData(): unknown {
    return this._deviceData
  }

  /** `true` se il dispositivo ha pubblicato una nuova configurazione non ancora applicata. */
  public get configurationUpdateAvailable(): boolean {
    return this._configurationUpdateAvailable
  }

  /**
   * Registra un callback invocato quando il dispositivo pubblica una nuova configurazione.
   * L'utente può quindi chiamare {@link applyConfigurationUpdate} per applicarla.
   */
  public onConfigurationUpdateAvailable(callback: () => void): void {
    this._configUpdateCallback = callback
  }

  /**
   * Applica la configurazione in attesa rendendola la configurazione attiva.
   * @returns La nuova configurazione attiva.
   * @throws {AirEdgeError} Se non è disponibile alcun aggiornamento.
   */
  public applyConfigurationUpdate(): V1Configuration {
    if (!this._pendingConfiguration) {
      throw new AirEdgeError('No configuration update available')
    }
    this._deviceConfiguration = this._pendingConfiguration
    this._pendingConfiguration = undefined
    this._configurationUpdateAvailable = false
    this._logger.info('Configuration update applied (v%s)', this._deviceConfiguration.Version)
    return this._deviceConfiguration
  }

  /**
   * Registra un callback invocato ad ogni aggiornamento dei dati.
   * @param callback Funzione chiamata con i nuovi dati ricevuti dal dispositivo.
   */
  public onData(callback: (data: unknown) => void): void {
    this._onDataCallback = callback
  }

  constructor(configuration: AirEdgeV1Configuration) {
    if (!configuration) throw new AirEdgeError('configuration is required')
    this._configuration = configuration
  }

  async connect() {
    if (this._mqttClient && this._mqttClient.isConnected) return

    // Se le opzioni MQTT sono presenti
    if (this._configuration.mqttOptions) {
      this._mqttClient = new AirEdgeMqttClient(
        this.configuration.mqttHost,
        this.configuration.mqttOptions
      )
    }
    // Altrimenti, utilizza le opzioni di connessione standard (username, password, clientId)
    else {
      this._mqttClient = new AirEdgeMqttClient(
        this.configuration.mqttHost,
        this.configuration.mqttUsername,
        this.configuration.mqttPassword,
        this.configuration.mqttClientId
      )
    }

    this._logger.info('Connecting to MQTT broker at %s', this.configuration.mqttHost)

    // Connessione al broker MQTT
    await this._mqttClient.connect()

    this._logger.info('Connected to MQTT broker, checking device configuration...')

    this._deviceConfiguration = await this.getDeviceConfiguration()

    this._logger.info(
      'Device %s is online (configuration v%s)',
      this.configuration.deviceId,
      this._deviceConfiguration.Version
    )

    await this.startDataPolling()
  }

  /**
   * Avvia il polling periodico dei dati dal dispositivo.
   * Si sottoscrive al topic di risposta e pubblica una richiesta ogni
   * {@link AirEdgeV1Configuration.dataPollingInterval} ms (default 10 000 ms).
   * Chiamata automaticamente da {@link connect}; può essere richiamata manualmente
   * dopo uno {@link stopDataPolling}.
   */
  async startDataPolling(): Promise<void> {
    if (this._dataPollingTimer !== undefined) return

    const interval = this.configuration.dataPollingInterval ?? 10_000

    const requestTopic = buildV1PublishTopic(
      this.configuration.mqttHost,
      mqtt_topics.get_data,
      this.configuration.deviceId
    )

    const responseTopic = buildV1SubscribeTopic(
      mqtt_topics.receive_data,
      this.configuration.deviceId
    )

    await this._mqttClient!.subscribe(responseTopic, (_, message) => {
      try {
        this._deviceData = JSON.parse(message.toString())
        this._onDataCallback?.(this._deviceData)
      } catch {
        // payload non valido — ignorato
      }
    })

    const poll = async () => {
      try {
        await this._mqttClient!.publish(requestTopic, '')
      } catch {
        // errore di publish silenzioso (es. disconnessione in corso)
      }
    }

    // Prima richiesta immediata, poi a intervalli regolari
    await poll()
    this._dataPollingTimer = setInterval(poll, interval)

    this._logger.info('Data polling started (interval: %dms) on topic: %s', interval, requestTopic)
  }

  /**
   * Ferma il polling periodico e si disottoscrive dal topic dei dati.
   * I dati già ricevuti rimangono disponibili in {@link deviceData}.
   */
  async stopDataPolling(): Promise<void> {
    if (this._dataPollingTimer === undefined) return

    clearInterval(this._dataPollingTimer)
    this._dataPollingTimer = undefined

    const responseTopic = buildV1SubscribeTopic(
      mqtt_topics.receive_data,
      this.configuration.deviceId
    )

    await this._mqttClient?.unsubscribe(responseTopic)

    this._logger.info('Data polling stopped')
  }

  /**
   * Invia la nuova configurazione al dispositivo e attende la conferma.
   * Aggiunge automaticamente `from` con il `mqttClientId` così il dispositivo
   * può restituire la configurazione aggiornata come conferma.
   * Durante l'operazione le notifiche di aggiornamento da altri utenti
   * sono soppresse: la prima risposta sul topic di configurazione è trattata
   * come conferma dell'invio.
   * @param config Nuova configurazione da applicare al dispositivo.
   * @returns La configurazione confermata dal dispositivo.
   * @throws {AirEdgeError} Se il dispositivo non risponde entro 10 secondi.
   */
  async setDeviceConfiguration(config: V1Configuration): Promise<V1Configuration> {
    const TIMEOUT_MS = 10_000

    const clientId = this.configuration.mqttClientId ?? ''

    const requestTopic = buildV1PublishTopic(
      this.configuration.mqttHost,
      mqtt_topics.set_device_configuration,
      this.configuration.deviceId
    )

    // Promise che si risolve quando il dispositivo risponde con la conferma
    const confirmation = new Promise<V1Configuration>((resolve, reject) => {
      this._configSettingResolve = resolve

      setTimeout(() => {
        if (this._configSettingResolve) {
          this._configSettingResolve = undefined
          reject(new AirEdgeError(`Configuration set timed out after ${TIMEOUT_MS}ms`))
        }
      }, TIMEOUT_MS)
    })

    await this._mqttClient!.publish(requestTopic, JSON.stringify({ ...config, from: clientId }))

    this._logger.info(
      'Configuration sent to device %s, awaiting confirmation...',
      this.configuration.deviceId
    )

    const confirmed = await confirmation
    this._deviceConfiguration = confirmed

    this._logger.info('Configuration confirmed by device (v%s)', confirmed.Version)

    return confirmed
  }

  async getDeviceConfiguration(
    max_attempts?: number,
    retry_delay_ms?: number
  ): Promise<V1Configuration> {
    const MAX_ATTEMPTS = max_attempts ?? 3
    const RETRY_DELAY_MS = retry_delay_ms ?? 2000

    const requestTopic = buildV1PublishTopic(
      this.configuration.mqttHost,
      mqtt_topics.get_device_configuration,
      this.configuration.deviceId
    )

    const responseTopic = buildV1SubscribeTopic(
      mqtt_topics.receive_device_configuration,
      this.configuration.deviceId
    )

    // Flag locale: falso durante la fase iniziale, vero dopo aver ricevuto la prima config.
    // Usato per distinguere la risposta iniziale dagli aggiornamenti successivi.
    let initialResolved = false

    let resolveConfig!: (config: V1Configuration) => void
    const configReceived = new Promise<V1Configuration>(resolve => {
      resolveConfig = resolve
    })

    await this._mqttClient!.subscribe(responseTopic, (_, message) => {
      try {
        const config = JSON.parse(message.toString()) as V1Configuration
        if (!initialResolved) {
          // Prima risposta: risolve la Promise della fase di connessione
          resolveConfig(config)
        } else if (this._configSettingResolve) {
          // Conferma di setDeviceConfiguration: intercetta e risolve, ignora update esterni
          const resolve = this._configSettingResolve
          this._configSettingResolve = undefined
          resolve(config)
        } else {
          // Aggiornamento successivo da un altro utente: notifica senza applicare automaticamente
          this._pendingConfiguration = config
          this._configurationUpdateAvailable = true
          this._configUpdateCallback?.()
          this._logger.info('Device configuration update available (v%s)', config.Version)
        }
      } catch {
        // payload non valido — si ignora, il tentativo andrà in timeout
      }
    })

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this._logger.info(
        'Configuration request attempt %d/%d on topic: %s',
        attempt,
        MAX_ATTEMPTS,
        requestTopic
      )

      await this._mqttClient!.publish(requestTopic, '')

      const result = await Promise.race([
        configReceived,
        new Promise<null>(resolve => setTimeout(() => resolve(null), RETRY_DELAY_MS)),
      ])

      if (result !== null) {
        // Attiva la modalità watch: i messaggi successivi sono aggiornamenti
        initialResolved = true
        return result
      }
    }

    // Tutti i tentativi falliti: pulizia e errore
    await this._mqttClient!.unsubscribe(responseTopic)
    await this._mqttClient!.disconnect()

    throw new AirEdgeDeviceOfflineError(
      `Device ${this.configuration.deviceId} did not respond after ${MAX_ATTEMPTS} attempts`
    )
  }
}
