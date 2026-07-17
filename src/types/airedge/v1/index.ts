import type ftp from 'basic-ftp'
import type mqtt from 'mqtt'

export interface AirEdgeV1Configuration {
  /**
   * The unique identifier of the device. This is typically a string that uniquely identifies the device in the AirEdge system.
   */
  deviceId: string
  mqttHost: string
  mqttUsername?: string
  mqttPassword?: string
  mqttClientId?: string
  mqttOptions?: mqtt.IClientOptions
  ftpHost: string
  ftpUsername?: string
  ftpPassword?: string
  ftpOptions?: ftp.AccessOptions
  dataPollingInterval?: number
}

export * from './configuration'
