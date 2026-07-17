import mqtt from 'mqtt'

export class AirEdgeMqttClient {
  private _client?: mqtt.MqttClient
  private _options: mqtt.IClientOptions
  private _brokerUrl: string

  constructor(brokerUrl: string, username?: string, password?: string)
  constructor(brokerUrl: string, options?: mqtt.IClientOptions)
  constructor(
    brokerUrl: string,
    optionsOrUsername?: mqtt.IClientOptions | string,
    password?: string
  ) {
    this._brokerUrl = brokerUrl
    if (typeof optionsOrUsername === 'string' || optionsOrUsername === undefined) {
      this._options = { username: optionsOrUsername, password }
    } else {
      this._options = optionsOrUsername
    }
  }

  async connect(): Promise<mqtt.MqttClient> {
    this._client = await mqtt.connectAsync(this._brokerUrl, this._options)
    return this._client
  }
}
