/** Shown only when the candidate actually has a choice to make. */
interface Props {
  label: string
  devices: MediaDeviceInfo[]
  value: string | null
  onChange: (id: string) => void
}

export function DevicePicker({ label, devices, value, onChange }: Props) {
  if (devices.length < 2) return null
  return (
    <label className="mt-3 block text-xs text-neutral-500">
      {label}
      <select
        className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-sm text-neutral-900"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}
