import type { ButtonHTMLAttributes } from 'react';

type ProfileSwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role' | 'children' | 'aria-checked'> & {
  checked: boolean;
};

export function ProfileSwitch({ checked, ...props }: ProfileSwitchProps) {
  return <button type="button" role="switch" aria-checked={checked} className="profile-switch" {...props} />;
}
