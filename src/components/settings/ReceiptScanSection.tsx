import { useSettings } from '../../hooks/useSettings'
import { Card } from '../Card'
import { Segmented } from '../Segmented'
import { Spinner } from '../Spinner'
import type { ReceiptScanProvider } from '../../types'

const OPTIONS: Array<{ value: ReceiptScanProvider; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'grok', label: 'Grok' },
]

export function ReceiptScanSection() {
  const { settings, error, update } = useSettings()
  const provider: ReceiptScanProvider = settings?.receiptScanProvider ?? 'off'

  return (
    <Card title="Receipt scanning">
      {error ? (
        <p role="alert" className="py-4 text-callout text-danger">
          Could not load settings. Check your connection.
        </p>
      ) : !settings ? (
        <div role="status" className="flex items-center gap-2 py-4 text-muted">
          <Spinner size={16} />
          <span className="text-callout">Loading</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Segmented
            value={provider}
            onChange={(next) => update.mutate({ receiptScanProvider: next })}
            options={OPTIONS}
            ariaLabel="Receipt scan provider"
          />
          <p className="text-caption text-muted">
            The matching API key must be set as a server secret. It is never entered in the app.
          </p>
          {update.isError && (
            <span role="alert" className="text-caption text-danger">
              Could not save. Try again.
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
