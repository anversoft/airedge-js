import mqtt from 'mqtt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AirEdgeMqttClient } from '../../src/core/mqtt'

vi.mock('mqtt', () => {
  const mockClient = {
    end: vi.fn(),
    on: vi.fn(),
  } as unknown as mqtt.MqttClient

  return {
    default: {
      connectAsync: vi.fn().mockResolvedValue(mockClient),
    },
  }
})

describe('AirEdgeMqttClient', () => {
  const brokerUrl = 'mqtts://broker.example.com:8883'

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor — username/password overload', () => {
    it('dovrebbe impostare le credenziali nelle opzioni', () => {
      const client = new AirEdgeMqttClient(brokerUrl, 'user', 'pass')
      // @ts-expect-error accesso a campo privato per test
      expect(client._options).toEqual({ username: 'user', password: 'pass' })
    })

    it('dovrebbe funzionare senza username e password', () => {
      const client = new AirEdgeMqttClient(brokerUrl)
      // @ts-expect-error accesso a campo privato per test
      expect(client._options).toEqual({
        username: undefined,
        password: undefined,
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
      const client = new AirEdgeMqttClient(brokerUrl, 'user', 'pass')
      const result = await client.connect()
      expect(result).toBeDefined()
    })

    it("dovrebbe propagare l'errore se mqtt.connectAsync rigetta", async () => {
      vi.mocked(mqtt.connectAsync).mockRejectedValueOnce(new Error('connection refused'))
      const client = new AirEdgeMqttClient(brokerUrl, 'user', 'wrong')
      await expect(client.connect()).rejects.toThrow('connection refused')
    })
  })
})
