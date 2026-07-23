"use client";
import { useRef, useState } from "react";
import type { ProductDetail, ProductInputField } from "@/lib/api";

const MAX = 200;

/** Labels of required fields the customer has not filled in. */
export function missingRequired(
  fields: ProductInputField[],
  values: Record<string, string>,
): string[] {
  return fields
    .filter((f) => f.required && !(values[f.label] ?? "").trim())
    .map((f) => f.label);
}

/** Admin-defined inputs for this product + the always-available optional note. */
export function CustomerInputs({
  fields,
  values,
  note,
  errors,
  onChange,
  onNoteChange,
}: {
  fields: ProductInputField[];
  values: Record<string, string>;
  note: string;
  errors: Record<string, string>;
  onChange: (label: string, value: string) => void;
  onNoteChange: (value: string) => void;
}) {
  return (
    <div className="mt-6 space-y-4">
      {fields.map((f) => (
        <div key={f.id}>
          <label htmlFor={`pf-${f.id}`} className="mb-1 block text-sm font-semibold text-plum">
            {f.label}
            {f.required && <span className="text-rose"> *</span>}
          </label>
          <input
            id={`pf-${f.id}`}
            value={values[f.label] ?? ""}
            maxLength={MAX}
            placeholder={f.placeholder}
            onChange={(e) => onChange(f.label, e.target.value)}
            className={`w-full rounded-xl border bg-surface px-4 py-3 text-base outline-none focus:border-plum ${
              errors[f.label] ? "border-rose" : "border-border"
            }`}
          />
          {errors[f.label] && <p className="mt-1 text-sm text-rose">{errors[f.label]}</p>}
        </div>
      ))}

      <div>
        <label htmlFor="pf-note" className="mb-1 block text-sm font-semibold text-plum">
          বিশেষ নির্দেশনা (ঐচ্ছিক)
        </label>
        <textarea
          id="pf-note"
          value={note}
          maxLength={MAX}
          rows={2}
          placeholder="কিছু বলার থাকলে লিখুন"
          onChange={(e) => onNoteChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-plum"
        />
      </div>
    </div>
  );
}

/**
 * Shared wiring for the three configurators: renders this product's admin-defined
 * inputs + the optional note, validates required ones, and builds the cart payload.
 */
/** Works for anything that defines admin inputs — a product OR a prebuilt combo.
 *  `initial` preloads existing answers when editing a cart line. */
export function useCustomerInputs(
  source: Pick<ProductDetail, "input_fields"> | { input_fields?: ProductInputField[] },
  initial?: { fields?: { label: string; value: string }[]; note?: string },
) {
  const fields = source.input_fields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.fields ?? []).map((f) => [f.label, f.value])),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);

  const node = (
    <div ref={ref}>
      <CustomerInputs
        fields={fields}
        values={values}
        note={note}
        errors={errors}
        onChange={(label, value) => setValues((s) => ({ ...s, [label]: value }))}
        onNoteChange={setNote}
      />
    </div>
  );

  /** True when every required field is filled; otherwise marks them and returns false.
   *  On failure it scrolls the inputs into view — they sit below the fold behind the
   *  sticky price bar, so without this the confirm button just looks dead. */
  function validate() {
    const missing = missingRequired(fields, values);
    setErrors(Object.fromEntries(missing.map((l) => [l, `${l} লিখুন`])));
    if (missing.length) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return missing.length === 0;
  }

  const payload = () => ({
    fields: fields
      .map((f) => ({ label: f.label, value: (values[f.label] ?? "").trim() }))
      .filter((f) => f.value),
    note: note.trim(),
  });

  return { node, validate, payload };
}
