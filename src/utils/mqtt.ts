/**
 * Costruisce un topic MQTT per la versione 1 del protocollo AirEdge.
 * @param host Host
 * @param topic Topic
 * @param deviceId ID del dispositivo
 * @return Il topic MQTT costruito, considerando se l'host è un indirizzo IP o un dominio.
 */
export function buildV1PublishTopic(host: string, topic: string, deviceId: string): string {
  if (!isLocalHost(host)) return `${deviceId}/${topic}`
  else return topic
}

/**
 * Costruisce un topic MQTT per la sottoscrizione alla versione 1 del protocollo AirEdge.
 * @param topic Topic
 * @param deviceId ID del dispositivo
 */
export function buildV1SubscribeTopic(topic: string, deviceId: string): string {
  return `${deviceId}/${topic}`
}

/**
 * Verifica se l'host fornito è un indirizzo IP o un dominio.
 * @param host L'host da verificare.
 */
export function isLocalHost(host: string): boolean {
  // rimuovi prefisso protocollo (mqtt://, mqtts://, tcp://, ws://, wss://, ecc.)
  const withoutProtocol = host.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, '')

  // rimuovi porta e path (es. "192.168.1.1:1883/path")
  const hostname = withoutProtocol.split(/[:,/?#]/)[0]

  // IPv4
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname!)

  // IPv6 (con o senza parentesi quadre: [::1] o ::1)
  const isIPv6 = /^\[?[0-9a-f:]+\]?$/i.test(hostname!)

  return isIPv4 || isIPv6
}
