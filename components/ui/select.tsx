import * as React from "react";

export type SelectOption = { value: string; label: string; disabled?: boolean };

// Select natif stylé (.ds-input + chevron). Accessible et léger : on garde le
// menu natif du navigateur plutôt qu'un listbox maison.
export const Select = React.forwardRef<
  HTMLSelectElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
    options: SelectOption[];
    size?: "sm" | "md";
    placeholder?: string;
    invalid?: boolean;
  }
>(function Select({ options, size = "md", placeholder, invalid, className = "", ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={["ds-input", size === "sm" ? "ds-input-sm" : "", invalid ? "ds-input-invalid" : "", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
});
