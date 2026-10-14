import type { InputHTMLAttributes } from 'react';

/** 输入框：高度 44px、字号 16px（低于 16px 会让窄屏浏览器在聚焦时缩放整个页面）。 */
export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input-field ${className}`.trim()} {...rest} />;
}
