import { Badge } from "@/components/ui/badge";

interface CweBadgeProps {
  num: number;
  desc?: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
}

export function CweBadge({
  num,
  desc,
  variant = "destructive",
}: CweBadgeProps) {
  return (
    <Badge variant={variant} className="text-xs" title={desc}>
      CWE-{num}
    </Badge>
  );
}
