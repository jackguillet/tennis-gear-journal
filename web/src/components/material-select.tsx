import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

export const MATERIALS: [string, string][] = [["poly", "Polyester"], ["multi", "Multifilament / nylon"], ["syngut", "Synthetic gut"], ["gut", "Natural gut"], ["hybrid", "Hybrid (gut or multi + poly)"], ["kevlar", "Aramid (Kevlar)"]]
export const PATTERNS: [string, string][] = [["16x19", "16 × 19"], ["18x20", "18 × 20"], ["16x18", "16 × 18"], ["18x19", "18 × 19"]]

// The phone's own picker (a wheel on iPhone), styled like the other fields.
export function OptionSelect({ id, value, onChange, options }: { id: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full text-base">
      {options.map(([v, label]) => <NativeSelectOption key={v} value={v}>{label}</NativeSelectOption>)}
    </NativeSelect>
  )
}
export const MaterialSelect = (p: { id: string; value: string; onChange: (v: string) => void }) => <OptionSelect {...p} options={MATERIALS} />
