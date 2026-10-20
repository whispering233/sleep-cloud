import type { ComponentPropsWithRef } from 'react';

/** 主要操作按钮：触摸目标不小于 44×44px。 */
export function PrimaryAction({ className = '', ...rest }: ComponentPropsWithRef<'button'>) {
  return <button className={`action-primary ${className}`.trim()} {...rest} />;
}
