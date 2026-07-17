export class AirEdgeError extends Error {}

export class AirEdgeConnectionError extends AirEdgeError {}

export class AirEdgeMqttConnectionError extends AirEdgeConnectionError {}

export class AirEdgeFtpConnectionError extends AirEdgeConnectionError {}

export class AirEdgeDeviceOfflineError extends AirEdgeError {}
