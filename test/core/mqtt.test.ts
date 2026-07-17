import mqtt from 'mqtt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AirEdgeMqttClient, MqttClientState } from '../../src/core/mqtt'

// vi.hoisted garantisce che mockClient ed eventHandlers siano disponibili
// sia all'interno della factory di vi.mock sia nei test
const { mockClient, eventHandlers } = vi.hoisted(() => {
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {}

  const mockClient = {
    connected: true,
    end: vi.fn(),
    endAsync: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers[event] = handler
    }),
    publishAsync: vi.fn().mockResolvedValue(undefined),
    subscribeAsync: vi.fn().mockResolvedValue([{ topic: 'test', qos: 0 }]),
    unsubscribeAsync: vi.fn().mockResolvedValue(undefined),
  }

  return { mockClient, eventHandlers }
})

vi.mock('mqtt', () => ({
  default: {
    connectAsync: vi.fn().mockResolvedValue(mockClient),
  },
}))

describe('AirEdgeMqttClient', () => {
  const brokerUrl = 'mqtts://broker.example.com:8883'

  afterEach(() => {
    vi.clearAllMocks()
    // ripristina le implementazioni rimaste invariate dopo clearAllMocks
    mockClient.endAsync.mockResolvedValue(undefined)
    vi.mocked(mqtt.connectAsync).mockResolvedValue(mockClient as unknown as mqtt.MqttClient)
    // rimuove i listener catturati dal test precedente
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key]
    }
  })

  // ─── constructor ────────────────────────────────────────────────────────────

  describe('constructor — username/password overload', () => {
    it('dovrebbe impostare le credenziali nelle opzioni', () => {
      const client = new AirEdgeMqttClient(brokerUrl, 'user', 'pass')
      // @ts-expect-error accesso a campo privato per test
      expect(client._options).toMatchObject({
        username: 'user',
        password: 'pass',
      })
    })

    it('dovrebbe impostare i default connectTimeout e reconnectRetryCount', () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      // @ts-expect-error accesso a campo privato per test
      expect(client._options).toMatchObject({
        connectTimeout: 10000,
        reconnectRetryCount: 5,
      })
    })
  })

  describe('constructor — IClientOptions overload', () => {
    it('dovrebbe accettare un oggetto IClientOptions', () => {
      const options: mqtt.IClientOptions = {
        username: 'user',
        password: 'pass',
      }
      const client = new AirEdgeMqttClient(brokerUrl, options)
      // @ts-expect-error accesso a campo privato per test
      expect(client._options).toEqual(options)
    })
  })

  // ─── state iniziale ──────────────────────────────────────────────────────────

  describe('state iniziale', () => {
    it('dovrebbe essere Disconnected prima di connettersi', () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      expect(client.state).toBe(MqttClientState.Disconnected)
    })
  })

  // ─── connect() ───────────────────────────────────────────────────────────────

  describe('connect()', () => {
    it('dovrebbe chiamare mqtt.connectAsync con brokerUrl e opzioni corretti', async () => {
      const options: mqtt.IClientOptions = {
        username: 'user',
        password: 'pass',
      }
      const client = new AirEdgeMqttClient(brokerUrl, options)
      await client.connect()
      expect(mqtt.connectAsync).toHaveBeenCalledOnce()
      expect(mqtt.connectAsync).toHaveBeenCalledWith(brokerUrl, options)
    })

    it('dovrebbe restituire il MqttClient', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      const result = await client.connect()
      expect(result).toBeDefined()
    })

    it('dovrebbe emettere Connecting poi Connected', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      const states: MqttClientState[] = []
      client.onStateChange(s => states.push(s))
      await client.connect()
      expect(states).toEqual([MqttClientState.Connecting, MqttClientState.Connected])
    })

    it('dovrebbe avere state === Connected dopo connect()', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      await client.connect()
      expect(client.state).toBe(MqttClientState.Connected)
    })

    it("dovrebbe emettere Connecting poi Disconnected e propagare l'errore se connectAsync rigetta", async () => {
      vi.mocked(mqtt.connectAsync).mockRejectedValueOnce(new Error('connection refused'))
      const client = new AirEdgeMqttClient(brokerUrl)
      const states: MqttClientState[] = []
      client.onStateChange(s => states.push(s))
      await expect(client.connect()).rejects.toThrow(
        `Failed to connect to MQTT broker at ${brokerUrl}`
      )
      expect(states).toEqual([MqttClientState.Connecting, MqttClientState.Disconnected])
    })
  })

  // ─── riconnessione automatica ─────────────────────────────────────────────────

  describe('riconnessione automatica', () => {
    it('dovrebbe emettere Reconnecting ad ogni tentativo', async () => {
      const client = new AirEdgeMqttClient(brokerUrl, {
        reconnectRetryCount: 5,
      })
      await client.connect()
      const states: MqttClientState[] = []
      client.onStateChange(s => states.push(s))

      eventHandlers['reconnect']()

      expect(states).toContain(MqttClientState.Reconnecting)
      expect(client.reconnectAttempts).toBe(1)
    })

    it('dovrebbe emettere ReconnectFailed e chiamare end(true) al raggiungimento del limite', async () => {
      const client = new AirEdgeMqttClient(brokerUrl, {
        reconnectRetryCount: 3,
      })
      await client.connect()
      const states: MqttClientState[] = []
      client.onStateChange(s => states.push(s))

      eventHandlers['reconnect']()
      eventHandlers['reconnect']()
      eventHandlers['reconnect']()

      expect(states).toContain(MqttClientState.ReconnectFailed)
      expect(mockClient.end).toHaveBeenCalledWith(true)
    })

    it('dovrebbe resettare il contatore e emettere Connected su reconnect riuscito', async () => {
      const client = new AirEdgeMqttClient(brokerUrl, {
        reconnectRetryCount: 5,
      })
      await client.connect()

      eventHandlers['reconnect']()
      eventHandlers['reconnect']()
      expect(client.reconnectAttempts).toBe(2)

      eventHandlers['connect']()
      expect(client.reconnectAttempts).toBe(0)
      expect(client.state).toBe(MqttClientState.Connected)
    })

    it('non dovrebbe gestire la riconnessione se _manualDisconnect è true', async () => {
      const client = new AirEdgeMqttClient(brokerUrl, {
        reconnectRetryCount: 3,
      })
      await client.connect()
      const states: MqttClientState[] = []
      client.onStateChange(s => states.push(s))

      // @ts-expect-error accesso a campo privato per test
      client._manualDisconnect = true
      eventHandlers['reconnect']()

      expect(states).not.toContain(MqttClientState.Reconnecting)
      expect(mockClient.end).not.toHaveBeenCalled()
    })

    it('dovrebbe emettere Disconnected e ripulire lo stato su close non manuale', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      await client.connect()
      const states: MqttClientState[] = []
      client.onStateChange(s => states.push(s))

      eventHandlers['close']()

      expect(states).toContain(MqttClientState.Disconnected)
      expect(client.client).toBeUndefined()
    })
  })

  // ─── disconnect() ────────────────────────────────────────────────────────────

  describe('disconnect()', () => {
    it('dovrebbe emettere Disconnecting poi Disconnected', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      await client.connect()
      const states: MqttClientState[] = []
      client.onStateChange(s => states.push(s))

      await client.disconnect()

      expect(states).toEqual([MqttClientState.Disconnecting, MqttClientState.Disconnected])
    })

    it('dovrebbe impostare manualDisconnect a true', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      await client.connect()
      await client.disconnect()
      expect(client.manualDisconnect).toBe(true)
    })

    it('dovrebbe chiamare endAsync', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      await client.connect()
      await client.disconnect()
      expect(mockClient.endAsync).toHaveBeenCalledOnce()
    })

    it('dovrebbe pulire client e callbacks dopo la disconnessione', async () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      await client.connect()
      await client.disconnect()
      expect(client.client).toBeUndefined()
      expect(client.isConnected).toBe(false)
    })
  })
})
