import { type AccessOptions, Client, type FTPResponse } from 'basic-ftp'

export class AirEdgeFTPClient {
  private _client?: Client
  private _options: AccessOptions

  public get client(): Client | undefined {
    return this._client
  }

  constructor(host: string, username?: string, password?: string)
  constructor(options?: AccessOptions)
  constructor(hostOrOptions?: string | AccessOptions, username?: string, password?: string) {
    if (typeof hostOrOptions === 'string' || hostOrOptions === undefined) {
      this._options = { host: hostOrOptions, user: username, password }
    } else {
      this._options = hostOrOptions
    }
  }

  async connect(): Promise<FTPResponse> {
    this._client = new Client()
    return this._client.access(this._options)
  }
}
