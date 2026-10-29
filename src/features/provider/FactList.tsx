/** A label / value list in the owner and admin surfaces' one fact style (a tinted block of term + value rows). */
function FactList({ rows }: { rows: ReadonlyArray<readonly [label: string, value: string]> }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-muted p-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export { FactList }
