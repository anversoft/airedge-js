import mqtt, { type ISubscriptionGrant, type OnMessageCallback } from 'mqtt'
import { AirEdgeMqttConnectionError } from '../errors'

export enum MqttClientState {
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Disconnecting = 'disconnecting',
  Disconnected = 'disconnected',
  ReconnectFailed = 'reconnect_failed',
}

export interface AirEdgeMqttClientOptions extends mqtt.IClientOptions {
  reconnectRetryCount?: number
}

/** Wrapper MQTT con gestione automatica della riconnessione e tracciamento dello stato. */
export class AirEdgeMqttClient {
  private _client?: mqtt.MqttClient
  private _options: AirEdgeMqttClientOptions
  private _brokerUrl: string
  private _callbacks: Map<string, OnMessageCallback> = new Map()
  private _manualDisconnect = false
  private _reconnectAttempts = 0
  private _state: MqttClientState = MqttClientState.Disconnected
  private _stateCallback?: (state: MqttClientState) => void
  /** Numero massimo di tentativi di riconnessione, calcolato una volta sola. */
  private _maxRetries = 5

  /** `true` se il client è attualmente connesso al broker. */
  public get isConnected(): boolean {
    return this._client?.connected ?? false
  }

  /** Stato corrente del ciclo di vita del client. */
  public get state(): MqttClientState {
    return this._state
  }

  /**
   * Registra un callback invocato ad ogni cambio di stato.
   * @param callback Funzione chiamata con il nuovo {@link MqttClientState}.
   */
  public onStateChange(callback: (state: MqttClientState) => void): void {
    this._stateCallback = callback
  }

  /** Numero di tentativi di riconnessione effettuati dall'ultima connessione riuscita. */
  public get reconnectAttempts(): number {
    return this._reconnectAttempts
  }

  /** Riferimento diretto al client MQTT sottostante, `undefined` se non connesso. */
  public get client(): mqtt.MqttClient | undefined {
    return this._client
  }

  /** `true` se la disconnessione è stata richiesta esplicitamente tramite {@link disconnect}. */
  public get manualDisconnect(): boolean {
    return this._manualDisconnect
  }

  constructor(brokerUrl: string, username?: string, password?: string, clientId?: string)
  constructor(brokerUrl: string, options?: AirEdgeMqttClientOptions)
  constructor(
    brokerUrl: string,
    optionsOrUsername?: AirEdgeMqttClientOptions | string,
    password?: string,
    clientId?: string
  ) {
    this._brokerUrl = brokerUrl
    if (typeof optionsOrUsername === 'string' || optionsOrUsername === undefined) {
      this._options = {
        username: optionsOrUsername,
        password,
        clientId,
        connectTimeout: 10000,
        reconnectRetryCount: 5,
      }
    } else {
      this._options = optionsOrUsername
    }
    this._maxRetries = this._options.reconnectRetryCount ?? 5
  }

  private _emitState(state: MqttClientState): void {
    this._state = state
    this._stateCallback?.(state)
  }

  /**
   * Stabilisce la connessione con il broker MQTT.
   * Registra i listener per riconnessione, chiusura e messaggi.
   * @returns Il client MQTT connesso.
   * @throws {@link AirEdgeMqttConnectionError} se la connessione fallisce.
   */
  async connect(): Promise<mqtt.MqttClient> {
    this._manualDisconnect = false
    this._reconnectAttempts = 0
    this._emitState(MqttClientState.Connecting)

    try {
      this._client = await mqtt.connectAsync(this._brokerUrl, this._options)
    } catch (error) {
      this._emitState(MqttClientState.Disconnected)
      throw new AirEdgeMqttConnectionError(
        `Failed to connect to MQTT broker at ${this._brokerUrl}`,
        {
          cause: error,
        }
      )
    }

    this._emitState(MqttClientState.Connected)

    this._client.on('reconnect', () => {
      if (this._manualDisconnect) return

      this._reconnectAttempts++
      this._emitState(MqttClientState.Reconnecting)

      if (this._reconnectAttempts >= this._maxRetries) {
        this._emitState(MqttClientState.ReconnectFailed)
        this._client?.end(true)
      }
    })

    this._client.on('connect', () => {
      this._reconnectAttempts = 0
      this._emitState(MqttClientState.Connected)
    })

    this._client.on('close', () => {
      if (!this._manualDisconnect) {
        this._emitState(MqttClientState.Disconnected)
        this._callbacks.clear()
        this._client = undefined
      }
    })

    this._client.on('message', (topic, message, packet) => {
      const callback = this._callbacks.get(topic)
      if (callback) {
        callback(topic, message, packet)
      }
    })

    return this._client
  }

  /**
   * Chiude la connessione in modo ordinato.
   * Imposta {@link manualDisconnect} a `true` per sopprimere la logica di riconnessione.
   */
  async disconnect(): Promise<void> {
    if (this._client && this._client.connected) {
      this._manualDisconnect = true
      this._emitState(MqttClientState.Disconnecting)
      await this._client.endAsync()
      this._callbacks.clear()
      this._client = undefined
      this._emitState(MqttClientState.Disconnected)
    }
  }

  /**
   * Pubblica un messaggio su un topic.
   * @param topic Topic di destinazione.
   * @param message Payload del messaggio.
   */
  async publish(topic: string, message: any): Promise<any> {
    this._checkConnection()
    return this._client!.publishAsync(topic, message)
  }

  /**
   * Sottoscrive un topic e registra il callback per i messaggi ricevuti.
   * @param topic Topic a cui sottoscriversi.
   * @param callback Funzione invocata alla ricezione di ogni messaggio.
   * @returns Lista dei grant restituiti dal broker.
   */
  async subscribe(topic: string, callback: OnMessageCallback): Promise<ISubscriptionGrant[]> {
    this._checkConnection()
    return this._client!.subscribeAsync(topic).then(grants => {
      this._callbacks.set(topic, callback)
      return grants
    })
  }

  /**
   * Cancella la sottoscrizione a uno o più topic.
   * @param topic Topic singolo o array di topic da cui disiscriversi.
   */
  async unsubscribe(topic: string | string[]): Promise<any> {
    this._checkConnection()
    return this._client!.unsubscribeAsync(topic).then(() => {
      if (typeof topic === 'string') {
        this._callbacks.delete(topic)
      } else {
        for (const t of topic) {
          this._callbacks.delete(t)
        }
      }
    })
  }

  /** @throws {@link AirEdgeMqttConnectionError} se il client non è connesso. */
  _checkConnection(): void {
    if (!this._client || !this._client.connected) {
      throw new AirEdgeMqttConnectionError('MQTT client is not connected')
    }
  }
}
