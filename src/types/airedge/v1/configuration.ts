// ─── Tipi condivisi ──────────────────────────────────────────────────────────

export interface V1Garanzia {
  Attiva: boolean
  Stato: boolean
  'Scadenza Garanzia': string // ISO 8601
}

export interface V1Alimentazione {
  Tensione: number
  Frequenza: number
  Fasi: number
  'Potenza Nominale': number
}

export interface V1Temperature {
  Minima: number
  Massima: number
}

// ─── Targa Compressore ───────────────────────────────────────────────────────

export interface V1TargaCompressore {
  Fabbricante: string
  Modello: string
  Matricola: string
  Codice: string
  'Anno di Costruzione': number
  'Marchio CE': boolean
  Garanzia: V1Garanzia
  'Pressione Nominale': number
  'Portata Nominale': number
  Alimentazione: V1Alimentazione
}

// ─── Targa Essiccatore ───────────────────────────────────────────────────────

export interface V1CircuitoRefrigerante {
  Volume: number
  'Gas Refrigerante': string
  'Quantità Gas': number
  Pressioni: {
    'Alta Pressione': number
    'Bassa Pressione': number
  }
  Temperature: V1Temperature
}

export interface V1CircuitoAriaCompressa {
  Volume: number
  'Pressione Nominale': number
  Temperature: V1Temperature
}

export interface V1TargaEssiccatore {
  Fabbricante: string
  Modello: string
  Matricola: string
  Codice: string
  'Anno di Costruzione': number
  'Marchio CE': boolean
  Garanzia: V1Garanzia
  'Portata Nominale': number
  Alimentazione: V1Alimentazione & { IP: string }
  'Circuito Refrigerante': V1CircuitoRefrigerante
  'Circuito Aria Compressa': V1CircuitoAriaCompressa
  Unità: {
    'Normativa Pressioni PED': string
    'Classe Frigo': number
    Temperature: V1Temperature
  }
}

// ─── Enumerazioni controller ──────────────────────────────────────────────────

/** Controller disponibili per i compressori. */
export enum V1CompressoreController {
  Elettromeccanico = 0,
  MaestroXS = 1,
  MaestroXB = 2,
  NeuronXT = 3,
  NeuronII = 4,
  Neuron3 = 5,
}

/** Controller disponibili per gli essiccatori. */
export enum V1EssiccatoreController {
  DMC24 = 0,
  DMC50_Rev01 = 1,
  DMC50_Rev03 = 2,
}

/** Controller disponibili per Logik. */
export enum V1LogikController {
  Logik103 = 0,
  Logik200 = 1,
}

// ─── Singoli dispositivi ─────────────────────────────────────────────────────

export interface V1Compressore {
  Enabled: boolean
  Controller: V1CompressoreController
  Name: string
  Family: number
  ModbusID: number
  Targa: V1TargaCompressore
}

export interface V1Essiccatore {
  Name: string
  Enabled: boolean
  Controller: V1EssiccatoreController
  Targa: V1TargaEssiccatore
}

export interface V1FasciaScaldante {
  Name: string
  Enabled: boolean
}

export interface V1Logik {
  Name: string
  Enabled: boolean
  Controller: V1LogikController
}

export interface V1Flussometro {
  Name: string
  Enabled: boolean
}

export interface V1Contatore {
  Name: string
  Enabled: boolean
}

// ─── Contenitore dispositivi ─────────────────────────────────────────────────

export interface V1Devices {
  Compressori: {
    C1: V1Compressore
    C2: V1Compressore
    C3: V1Compressore
    C4: V1Compressore
  }
  Essiccatori: {
    'Essiccatore 1': V1Essiccatore
    'Essiccatore 2': V1Essiccatore
  }
  'Fasce Scaldanti': {
    'Fascia 1': V1FasciaScaldante
    'Fascia 2': V1FasciaScaldante
  }
  Flussometro: V1Flussometro
  Contatore: V1Contatore
  Logik: V1Logik
}

// ─── Configurazione principale ────────────────────────────────────────────────

export interface V1VersionFeatures {
  ErrorGlobalTopic: boolean
  ElgiN3Support: boolean
  ReadWriteCustomFiles: boolean
  SchedulerReturnEmpty: boolean
  AlarmsOutput: boolean
}

export interface V1Configuration {
  Id: string
  Name: string
  Type: string
  EmailSend: string[]
  Devices: V1Devices
  Version: string
  VersionFeatures: V1VersionFeatures
}
