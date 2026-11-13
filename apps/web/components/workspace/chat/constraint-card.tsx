"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type {
  CardAnswer,
  ConstraintCard,
  ConstraintStep,
} from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AnswerPayload =
  | { answers: Record<string, CardAnswer> }
  | { values: string[]; isCustom: boolean };

type ConstraintCardViewProps = {
  card: ConstraintCard;
  disabled: boolean;
  onSubmit: (payload: AnswerPayload) => void;
};

const labelsFor = (
  step: ConstraintStep,
  answer: CardAnswer | null | undefined,
): string =>
  answer
    ? answer.values
        .map(
          (value) =>
            step.options.find((option) => option.value === value)?.label ??
            value,
        )
        .join("、")
    : "";

const AnsweredCard = ({ card }: { card: ConstraintCard }) => {
  const steps = useMemo<ConstraintStep[]>(
    () =>
      card.steps ?? [
        {
          id: "value",
          title: card.title,
          question: "",
          options: card.options,
        },
      ],
    [card],
  );
  const ignored = card.status === "ignored";

  return (
    <div className="mt-3 rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium">
          {ignored ? "已忽略的约束" : "已确认的约束"}
        </p>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Check className="size-3" strokeWidth={2} />
          {ignored ? "已忽略" : "已作答"}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {steps.map((step, index) => {
          const answer =
            card.answers?.[step.id] ?? (index === 0 ? card.answer : null);
          const label = labelsFor(step, answer);

          return (
            <div
              key={step.id}
              className="flex items-center justify-between gap-3 text-[11px]"
            >
              <span className="text-muted-foreground">{step.title}</span>
              <span className="font-medium">
                {label || (ignored ? "已跳过" : "已选择")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const LegacyCard = ({
  card,
  disabled,
  onSubmit,
}: ConstraintCardViewProps) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const answered = card.status !== "pending";
  const isDisabled = disabled || answered;

  if (answered) {
    return <AnsweredCard card={card} />;
  }

  const submit = (values: string[], isCustom = false) => {
    if (
      values.length > 0 &&
      values.every((value) => value.trim().length > 0) &&
      !isDisabled
    ) {
      onSubmit({ values, isCustom });
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <p className="text-[12px] font-medium">{card.title}</p>

      <div className="mt-3 space-y-1.5">
        {card.options.map((option) => {
          const active = selected.includes(option.value);

          return (
            <button
              key={option.value}
              type="button"
              disabled={isDisabled}
              onClick={() => {
                if (card.kind === "single") {
                  submit([option.value]);
                  return;
                }

                setSelected((current) =>
                  current.includes(option.value)
                    ? current.filter((item) => item !== option.value)
                    : [...current, option.value],
                );
              }}
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                active
                  ? "border-foreground/30 bg-secondary"
                  : "border-border hover:bg-secondary",
                isDisabled && "cursor-default opacity-70",
              )}
            >
              <span>
                <span className="block text-[11px] font-medium">
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
              {active && (
                <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
              )}
            </button>
          );
        })}
      </div>

      {card.kind !== "text" && (
        <div className="mt-2">
          <div className="flex gap-2">
            <Input
              value={custom}
              disabled={isDisabled}
              placeholder="其他：也可以直接输入"
              className="h-8"
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit([custom.trim()], true);
                }
              }}
            />
            <Button
              size="sm"
              disabled={!custom.trim() || isDisabled}
              onClick={() => submit([custom.trim()], true)}
            >
              确认
            </Button>
          </div>
        </div>
      )}

      {card.kind === "multi" && (
        <Button
          size="sm"
          className="mt-2 w-full"
          disabled={selected.length === 0 || isDisabled}
          onClick={() => submit(selected)}
        >
          确认选择
        </Button>
      )}

      {card.kind === "text" && (
        <div className="mt-2 flex gap-2">
          <Input
            value={custom}
            disabled={isDisabled}
            placeholder="其他：也可以直接输入"
            className="h-8"
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit([custom.trim()], true);
              }
            }}
          />
          <Button
            size="sm"
            disabled={!custom.trim() || isDisabled}
            onClick={() => submit([custom.trim()], true)}
          >
            确认
          </Button>
        </div>
      )}
    </div>
  );
};

const WizardCard = ({
  card,
  disabled,
  onSubmit,
}: ConstraintCardViewProps) => {
  const steps = card.steps ?? [];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, CardAnswer>>(
    card.answers ?? {},
  );
  const current = steps[index];
  const answered = card.status !== "pending";
  const isDisabled = disabled || answered;

  if (!current) {
    return null;
  }

  const selected = answers[current.id]?.values ?? [];
  const complete = steps.every((step) => answers[step.id]?.values.length);

  const choose = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed || isDisabled) {
      return;
    }

    const answer: CardAnswer = { values: [trimmed], isCustom: false };

    setAnswers((prev) => ({
      ...prev,
      [current.id]: answer,
    }));

    if (steps.length === 1) {
      onSubmit({
        answers: {
          ...answers,
          [current.id]: answer,
        },
      });
      return;
    }

    if (index < steps.length - 1) {
      window.setTimeout(() => {
        setIndex((valueIndex) =>
          Math.min(valueIndex + 1, steps.length - 1),
        );
      }, 160);
    }
  };

  /** 自定义输入实时写入答案；不自动跳转，由底部“确认并继续”统一提交。 */
  const handleCustomInput = (value: string) => {
    const trimmed = value.trim();

    setAnswers((prev) => {
      const next = { ...prev };

      if (trimmed) {
        next[current.id] = { values: [trimmed], isCustom: true };
      } else {
        delete next[current.id];
      }

      return next;
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium">{card.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="上一项约束"
            disabled={index === 0}
            onClick={() => {
              setIndex((value) => Math.max(0, value - 1));
            }}
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="下一项约束"
            disabled={index === steps.length - 1}
            onClick={() => {
              setIndex((value) => Math.min(steps.length - 1, value + 1));
            }}
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="mt-2.5">
        <p className="text-[11px] font-medium">{current.title}</p>
        {current.question && (
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            {current.question}
          </p>
        )}
      </div>

      <div className="mt-2.5 space-y-1.5">
        {current.options.map((option) => {
          const active = selected.includes(option.value);

          return (
            <button
              key={option.value}
              type="button"
              disabled={isDisabled}
              onClick={() => choose(option.value)}
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                active
                  ? "border-foreground/30 bg-secondary"
                  : "border-border hover:bg-secondary",
                isDisabled && "cursor-default opacity-70",
              )}
            >
              <span>
                <span className="block text-[11px] font-medium">
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </span>
              {active && (
                <Check className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2">
        <Input
          value={
            answers[current.id]?.isCustom
              ? (answers[current.id]?.values[0] ?? "")
              : ""
          }
          disabled={isDisabled}
          placeholder="其他：也可以直接输入"
          className="h-8"
          onChange={(event) => handleCustomInput(event.target.value)}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {steps.map((step, stepIndex) => (
            <span
              key={step.id}
              className={cn(
                "size-1.5 rounded-full",
                answers[step.id]?.values.length
                  ? "bg-foreground"
                  : stepIndex === index
                    ? "bg-muted-foreground"
                    : "bg-border",
              )}
            />
          ))}
        </div>
        <Button
          size="sm"
          disabled={!complete || isDisabled}
          onClick={() => onSubmit({ answers })}
        >
          确认并继续
        </Button>
      </div>
    </div>
  );
};

export const ConstraintCardView = (props: ConstraintCardViewProps) => {
  const { card } = props;

  if (card.status !== "pending") {
    return <AnsweredCard card={card} />;
  }

  if (card.steps && card.steps.length > 0) {
    return <WizardCard {...props} />;
  }

  return <LegacyCard {...props} />;
};
