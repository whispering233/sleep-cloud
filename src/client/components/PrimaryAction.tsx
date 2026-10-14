import type { ButtonHTMLAttributes } from 'react';

/** 主要操作按钮：触摸目标不小于 44×44px。 */
export function PrimaryAction({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`action-primary ${className}`.trim()} {...rest} />;
}
