import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost'
}

/** Shared button with consistent interaction states (FR-022/FR-023). */
export function Button({
  variant = 'default',
  className = '',
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  const variantClass =
    variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : ''
  return <button type={type} className={`btn ${variantClass} ${className}`.trim()} {...props} />
}

interface NumberFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function NumberField({
  label,
  className = '',
  ...props
}: NumberFieldProps): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor={props.id}>{label}</label>
      <input type="number" className={className} {...props} />
    </div>
  )
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function TextField({
  label,
  className = '',
  ...props
}: TextFieldProps): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor={props.id}>{label}</label>
      <input type="text" className={className} {...props} />
    </div>
  )
}

export function FieldError({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="field error">{children}</p>
}
