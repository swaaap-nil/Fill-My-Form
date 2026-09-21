import {
  CheckCircle2,
  HelpCircle,
  ListChecks,
  ShieldAlert,
  SplitSquareVertical,
} from "lucide-react";
import { useEffect } from "react";
import { AutosaveTextField } from "~/components/memory/autosave-text-field";
import {
  type FieldStatus,
  useMemoryAutosave,
} from "~/components/memory/use-memory-autosave";
import { Button } from "~/components/ui/button";
import { ontology } from "~/core/ontology";
import type { DecisionId, FieldProposal } from "~/lib/messaging";

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
  readonly confirmedIds: ReadonlySet<DecisionId>;
  readonly autosave?: {
    readonly value: string;
    readonly status: FieldStatus;
    readonly onChange: (value: string) => void;
  };
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

const NoValueProposal = ({
  conceptKey,
  autosave,
}: {
  readonly conceptKey: string;
  readonly autosave?: ProposalCardProps["autosave"];
}) => {
  const concept = ontology.byKey(conceptKey);
  const label = concept?.label ?? conceptKey;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-card p-3 shadow-sm shadow-black/5 dark:shadow-black/20">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <HelpCircle className="size-4" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 text-sm">
          We know this is <span className="font-medium">{conceptKey}</span>, but
          you haven't saved a value for it yet — enter it below.
        </p>
      </div>
      {concept?.expects === "file" || !autosave ? null : (
        <AutosaveTextField
          fieldKey={conceptKey}
          label={label}
          showLabel={false}
          expects={concept?.expects}
          value={autosave.value}
          status={autosave.status}
          onChange={autosave.onChange}
        />
      )}
    </div>
  );
};

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

const ChooseOptionProposal = ({
  proposal,
  onConfirm,
  confirmedIds,
}: {
  readonly proposal: Extract<FieldProposal, { state: "choose_option" }>;
  readonly onConfirm: (decisionId: string) => void;
  readonly confirmedIds: ReadonlySet<DecisionId>;
}) => {
  const chosen = proposal.choices.find((c) => confirmedIds.has(c.decisionId));
  return (
    <CardShell
      icon={<ListChecks className="size-4 text-muted-foreground" />}
      tone="muted"
    >
      <p className="text-sm">
        <span className="font-medium">{proposal.conceptKey}</span>: we have "
        {proposal.storedValue}" saved, but this field's own choices don't match
        it exactly. Which one did you mean?
      </p>
      <div className="flex flex-wrap gap-2">
        {proposal.choices.map((choice) => (
          <Button
            key={choice.decisionId}
            type="button"
            size="sm"
            variant={
              chosen?.decisionId === choice.decisionId ? "default" : "outline"
            }
            disabled={!!chosen}
            onClick={() => onConfirm(choice.decisionId)}
          >
            {chosen?.decisionId === choice.decisionId
              ? `Filled: ${choice.label}`
              : choice.label}
          </Button>
        ))}
      </div>
    </CardShell>
  );
};

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
      data-testid="proposal-confirm"
    >
      {confirmed ? "Filled" : "Confirm"}
    </Button>
  </CardShell>
);

export const ProposalCard = ({
  proposal,
  onConfirm,
  confirmedIds,
  autosave,
}: ProposalCardProps) => {
  switch (proposal.state) {
    case "unknown":
      return <UnknownProposal proposal={proposal} />;
    case "no_value":
      return (
        <NoValueProposal conceptKey={proposal.conceptKey} autosave={autosave} />
      );
    case "ambiguous":
      return <AmbiguousProposal candidates={proposal.candidates} />;
    case "choose_option":
      return (
        <ChooseOptionProposal
          proposal={proposal}
          onConfirm={onConfirm}
          confirmedIds={confirmedIds}
        />
      );
    case "pending":
      return (
        <PendingProposal
          proposal={proposal}
          onConfirm={onConfirm}
          confirmed={confirmedIds.has(proposal.decisionId)}
          restricted={false}
        />
      );
    case "restricted":
      return (
        <PendingProposal
          proposal={proposal}
          onConfirm={onConfirm}
          confirmed={confirmedIds.has(proposal.decisionId)}
          restricted={true}
        />
      );
  }
};

export const KnownFieldsDetails = ({
  proposals,
  onConfirm,
  confirmedIds,
  onRememberedChange,
}: {
  readonly proposals: readonly FieldProposal[];
  readonly onConfirm: (decisionId: string) => void;
  readonly confirmedIds: ReadonlySet<DecisionId>;
  readonly onRememberedChange: (remembered: boolean) => void;
}) => {
  const autosave = useMemoryAutosave();
  const remembered = proposals.some(
    (proposal) =>
      proposal.state === "no_value" &&
      autosave.getStatus(proposal.conceptKey) === "saved",
  );

  useEffect(() => {
    onRememberedChange(remembered);
  }, [onRememberedChange, remembered]);

  return (
    <>
      {proposals.map((proposal) => {
        const conceptKey =
          proposal.state === "no_value" ? proposal.conceptKey : undefined;
        const concept = conceptKey ? ontology.byKey(conceptKey) : undefined;
        return (
          <ProposalCard
            key={proposal.fieldId}
            proposal={proposal}
            onConfirm={onConfirm}
            confirmedIds={confirmedIds}
            autosave={
              conceptKey
                ? {
                    value: autosave.values[conceptKey] ?? "",
                    status: autosave.getStatus(conceptKey),
                    onChange: (value) =>
                      autosave.updateTextField(
                        conceptKey,
                        value,
                        concept?.label ?? conceptKey,
                      ),
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
};
