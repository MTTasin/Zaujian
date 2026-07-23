import { Button } from "./Button";

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-4xl">{icon}</div>}
      <p className="font-display text-lg font-bold text-plum">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {action && (
        <Button className="mt-2" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
