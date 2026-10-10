interface AvatarProps {
  name: string;
  url?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const Avatar = ({ name, url, size = 'md' }: AvatarProps) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  };

  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center font-bold border border-[var(--color-primary)]/20`}>
      {url ? <img src={url} alt={name} className="w-full h-full rounded-full object-cover" /> : initials}
    </div>
  );
};
