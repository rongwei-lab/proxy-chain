import { Plus } from 'lucide-react'
import type { ProxyNodeType } from '../lib'
import type { ManualNodeFormState } from './manual-node-form-state'
import type { UiCopy } from './types-i18n'

export function ManualNodeForm({
  copy,
  form,
  setForm,
  onSubmit,
  submitLabel,
}: {
  copy: UiCopy
  form: ManualNodeFormState
  setForm: React.Dispatch<React.SetStateAction<ManualNodeFormState>>
  onSubmit: (e: React.FormEvent) => void
  submitLabel?: string
}) {
  return (
    <form className="source-form manual-form" onSubmit={onSubmit}>
      <div className="field-grid three-col">
        <label className="field">
          <span>{copy.manualProtocolLabel}</span>
          <select
            className="select-input"
            value={form.protocol}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, protocol: e.target.value as ProxyNodeType }))
            }
          >
            <option value="vless">VLESS</option>
            <option value="socks5">SOCKS5</option>
            <option value="hysteria2">Hysteria2</option>
            <option value="ss">Shadowsocks (SS)</option>
          </select>
        </label>
        <label className="field">
          <span>{copy.manualNameLabel}</span>
          <input
            type="text"
            className="text-input"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Tokyo-01"
          />
        </label>
        <label className="field">
          <span>{copy.manualPortLabel}</span>
          <input
            type="number"
            min={1}
            max={65535}
            className="text-input"
            value={form.port}
            onChange={(e) => setForm((p) => ({ ...p, port: e.target.value }))}
            required
          />
        </label>
      </div>

      <label className="field">
        <span>{copy.manualServerLabel}</span>
        <input
          type="text"
          className="text-input"
          value={form.server}
          onChange={(e) => setForm((p) => ({ ...p, server: e.target.value }))}
          placeholder="edge.example.com"
          required
        />
      </label>

      {form.protocol === 'vless' ? (
        <div className="protocol-subform">
          <div className="field-grid two-col">
            <label className="field">
              <span>{copy.manualUuidLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.uuid}
                onChange={(e) => setForm((p) => ({ ...p, uuid: e.target.value }))}
                placeholder="11111111-1111-4111-8111-111111111111"
                required
              />
            </label>
            <label className="field">
              <span>{copy.manualSecurityLabel}</span>
              <select
                className="select-input"
                value={form.security}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    security: e.target.value as 'none' | 'tls' | 'reality',
                  }))
                }
              >
                <option value="reality">Reality</option>
                <option value="tls">TLS</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
          <div className="field-grid two-col">
            <label className="field">
              <span>{copy.manualTransportLabel}</span>
              <select
                className="select-input"
                value={form.packetType}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    packetType: e.target.value as 'tcp' | 'ws' | 'grpc',
                  }))
                }
              >
                <option value="tcp">TCP</option>
                <option value="ws">WebSocket (ws)</option>
                <option value="grpc">gRPC</option>
              </select>
            </label>
            <label className="field">
              <span>{copy.manualSniLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.sni}
                onChange={(e) => setForm((p) => ({ ...p, sni: e.target.value }))}
              />
            </label>
          </div>

          {form.security === 'reality' ? (
            <div className="field-grid three-col">
              <label className="field">
                <span>{copy.manualPbkLabel}</span>
                <input
                  type="text"
                  className="text-input"
                  value={form.pbk}
                  onChange={(e) => setForm((p) => ({ ...p, pbk: e.target.value }))}
                  required
                />
              </label>
              <label className="field">
                <span>{copy.manualSidLabel}</span>
                <input
                  type="text"
                  className="text-input"
                  value={form.sid}
                  onChange={(e) => setForm((p) => ({ ...p, sid: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>{copy.manualFpLabel}</span>
                <input
                  type="text"
                  className="text-input"
                  value={form.fp}
                  onChange={(e) => setForm((p) => ({ ...p, fp: e.target.value }))}
                />
              </label>
            </div>
          ) : null}

          {form.packetType === 'ws' ? (
            <div className="field-grid two-col">
              <label className="field">
                <span>{copy.manualWsPathLabel}</span>
                <input
                  type="text"
                  className="text-input"
                  value={form.wsPath}
                  onChange={(e) => setForm((p) => ({ ...p, wsPath: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>{copy.manualWsHostLabel}</span>
                <input
                  type="text"
                  className="text-input"
                  value={form.wsHost}
                  onChange={(e) => setForm((p) => ({ ...p, wsHost: e.target.value }))}
                />
              </label>
            </div>
          ) : null}

          {form.packetType === 'grpc' ? (
            <label className="field">
              <span>{copy.manualGrpcServiceLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.grpcServiceName}
                onChange={(e) => setForm((p) => ({ ...p, grpcServiceName: e.target.value }))}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {form.protocol === 'socks5' ? (
        <div className="field-grid two-col">
          <label className="field">
            <span>{copy.manualUsernameLabel}</span>
            <input
              type="text"
              className="text-input"
              value={form.username}
              onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>{copy.manualPasswordLabel}</span>
            <input
              type="password"
              autoComplete="off"
              className="text-input"
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            />
          </label>
        </div>
      ) : null}

      {form.protocol === 'ss' ? (
        <div className="protocol-subform">
          <div className="field-grid two-col">
            <label className="field">
              <span>{copy.manualCipherLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.cipher}
                onChange={(e) => setForm((p) => ({ ...p, cipher: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>{copy.manualPasswordLabel}</span>
              <input
                type="password"
                autoComplete="off"
                className="text-input"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                required
              />
            </label>
          </div>
          <div className="field-grid two-col">
            <label className="field">
              <span>{copy.manualPluginLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.plugin}
                onChange={(e) => setForm((p) => ({ ...p, plugin: e.target.value }))}
                placeholder="v2ray-plugin / obfs"
              />
            </label>
            <label className="field">
              <span>{copy.manualPluginOptsLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.pluginOptsRaw}
                onChange={(e) => setForm((p) => ({ ...p, pluginOptsRaw: e.target.value }))}
              />
            </label>
          </div>
        </div>
      ) : null}

      {form.protocol === 'hysteria2' ? (
        <div className="protocol-subform">
          <div className="field-grid two-col">
            <label className="field">
              <span>{copy.manualPasswordLabel}</span>
              <input
                type="password"
                autoComplete="off"
                className="text-input"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>{copy.manualSniLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.sni}
                onChange={(e) => setForm((p) => ({ ...p, sni: e.target.value }))}
              />
            </label>
          </div>
          <div className="field-grid three-col">
            <label className="field">
              <span>{copy.manualHy2ObfsLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.hy2Obfs}
                onChange={(e) => setForm((p) => ({ ...p, hy2Obfs: e.target.value }))}
                placeholder="salamander"
              />
            </label>
            <label className="field">
              <span>{copy.manualHy2ObfsPasswordLabel}</span>
              <input
                type="password"
                autoComplete="off"
                className="text-input"
                value={form.hy2ObfsPassword}
                onChange={(e) => setForm((p) => ({ ...p, hy2ObfsPassword: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>{copy.manualHy2PortsLabel}</span>
              <input
                type="text"
                className="text-input"
                value={form.hy2Ports}
                onChange={(e) => setForm((p) => ({ ...p, hy2Ports: e.target.value }))}
                placeholder="20000-30000"
              />
            </label>
          </div>
        </div>
      ) : null}

      <div className="checkbox-row">
        <label className="switch-label">
          <input
            type="checkbox"
            checked={form.udp}
            onChange={(e) => setForm((p) => ({ ...p, udp: e.target.checked }))}
          />
          <span>{copy.manualUdpLabel}</span>
        </label>
        {form.protocol === 'vless' ||
        form.protocol === 'hysteria2' ||
        form.protocol === 'socks5' ? (
          <label className="switch-label">
            <input
              type="checkbox"
              checked={form.skipCertVerify}
              onChange={(e) => setForm((p) => ({ ...p, skipCertVerify: e.target.checked }))}
            />
            <span>{copy.manualSkipCertLabel}</span>
          </label>
        ) : null}
      </div>

      <div className="form-actions">
        <button type="submit" className="primary-btn sm">
          <Plus size={15} aria-hidden="true" />
          {submitLabel ?? copy.addManualBtn}
        </button>
      </div>
    </form>
  )
}
