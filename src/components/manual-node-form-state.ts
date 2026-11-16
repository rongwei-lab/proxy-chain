import type { ProxyNodeType } from '../lib'

export interface ManualNodeFormState {
  protocol: ProxyNodeType
  name: string
  server: string
  port: string
  uuid: string
  security: 'none' | 'tls' | 'reality'
  packetType: 'tcp' | 'ws' | 'grpc'
  sni: string
  fp: string
  pbk: string
  sid: string
  wsPath: string
  wsHost: string
  grpcServiceName: string
  username: string
  password: string
  cipher: string
  plugin: string
  pluginOptsRaw: string
  hy2Obfs: string
  hy2ObfsPassword: string
  hy2Ports: string
  udp: boolean
  skipCertVerify: boolean
}

export const INITIAL_MANUAL_FORM: ManualNodeFormState = {
  protocol: 'vless',
  name: '',
  server: '',
  port: '443',
  uuid: '',
  security: 'reality',
  packetType: 'tcp',
  sni: '',
  fp: 'chrome',
  pbk: '',
  sid: '',
  wsPath: '/',
  wsHost: '',
  grpcServiceName: '',
  username: '',
  password: '',
  cipher: 'aes-256-gcm',
  plugin: '',
  pluginOptsRaw: '',
  hy2Obfs: '',
  hy2ObfsPassword: '',
  hy2Ports: '',
  udp: true,
  skipCertVerify: false,
}
