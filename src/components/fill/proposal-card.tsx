import {
  CheckCircle2,
  HelpCircle,
  ShieldAlert,
  SplitSquareVertical,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import type { FieldProposal } from "~/lib/messaging";

/**
 * One card per {@link FieldProposal} state. Deliverable 5 asks for a
 * distinct component per state — not a shared card with a switch inside —
 * so a designer can restyle "ambiguous" without touching "restricted", and
 * for an icon per state rather than colour alone, since colour meanings
 * will change with the design and colour-only signalling excludes some
 * users regardless of what the design ends up being.
 */

interface ProposalCardProps {
  readonly proposal: FieldProposal;
  readonly onConfirm: (decisionId: string) => void;
  readonly confirmed: boolean;
}

const fieldName = (proposal: FieldProposal): string =>
  proposal.fieldLabel ?? proposal.fieldId;

const CardShell = ({
  icon,
  tone,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly tone: "muted" | "warning" | "default";
  readonly children: React.ReactNode;
}) => (
  <div
    className={
      tone === "warning"
        ? "flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3"
        : tone === "muted"
          ? "flex items-start gap-3 rounded-lg border border-border bg-muted/60 p-3"
          : "flex items-start gap-3 rounded-lg border border-primary/25 bg-card p-3 shadow-sm shadow-black/5 dark:shadow-black/20"
    }
  >
    <span className="mt-0.5 shrink-0">{icon}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
  </div>
);

const UnknownProposal = ({
  proposal,
}: {
  readonly proposal: Extract<FieldProposal, { state: "unknown" }>;
}) => (
  <CardShell
    icon={<HelpCircle className="size-4 text-muted-foreground" />}
    tone="muted"
  >
    <p className="text-sm">
      We don't recognise{" "}
      <span className="font-medium">{fieldName(proposal)}</span>.
    </p>
  </CardShell>
);

const NoValueProposal = ({ conceptKey }: { readonly conceptKey: string }) => (
  <CardShell
    icon={<HelpCircle className="size-4 text-muted-foreground" />}
    tone="muted"
  >
    <p className="text-sm">
      We know this is <span className="font-medium">{conceptKey}</span>, but you
      haven't saved a value for it yet — add it in onboarding.
    </p>
  </CardShell>
);

const AmbiguousProposal = ({
  candidates,
}: {
  readonly candidates: readonly string[];
}) => (
  <CardShell
    icon={<SplitSquareVertical className="size-4 text-muted-foreground" />}
    tone="muted"
  >
    <p className="text-sm">This could be more than one thing:</p>
    <ul className="list-inside list-disc text-muted-foreground text-xs">
      {candidates.map((key) => (
        <li key={key}>{key}</li>
      ))}
    </ul>
  </CardShell>
);

const PendingProposal = ({
  proposal,
  onConfirm,
  confirmed,
  restricted,
}: {
  readonly proposal: Extract<
    FieldProposal,
    { state: "pending" | "restricted" }
  >;
  readonly onConfirm: (decisionId: string) => void;
  readonly confirmed: boolean;
  readonly restricted: boolean;
}) => (
  <CardShell
    icon={
      restricted ? (
        <ShieldAlert className="size-4 text-destructive" />
      ) : (
        <CheckCircle2 className="size-4 text-primary" />
      )
    }
    tone={restricted ? "warning" : "default"}
  >
    <p className="text-sm">
      <span className="font-medium">{proposal.conceptKey}</span>:{" "}
      {proposal.value}
    </p>
    <p className="text-muted-foreground text-xs">
      Source: {proposal.source} · {proposal.policyReason}
    </p>
    {restricted && (
      <p className="text-destructive text-xs">
        This is sensitive. Confirm only if you mean to fill it here.
      </p>
    )}
    <Button
      type="button"
      size="sm"
      variant={restricted ? "destructive" : "default"}
      disabled={confirmed}
      onClick={() => onConfirm(proposal.decisionId)}
    >
      {confirmed ? "Filled" : "Confirm"}
    </Button>
  </CardShell>
);

export const ProposalCard = ({
  proposal,
  onConfirm,
  confirmed,
}: ProposalCardProps) => {
  switch (proposal.state) {
    case "unknown":
      return <UnknownProposal proposal={proposal} />;
    case "no_value":
      return <NoValueProposal conceptKey={proposal.conceptKey} />;
    case "ambiguous":
      return <AmbiguousProposal candidates={proposal.candidates} />;
    case "pending":
      return (
        <PendingProposal
          proposal={proposal}
          onConfirm={onConfirm}
          confirmed={confirmed}
          restricted={false}
        />
      );
    case "restricted":
      return (
        <PendingProposal
          proposal={proposal}
          onConfirm={onConfirm}
          confirmed={confirmed}
          restricted={true}
        />
      );
  }
};
