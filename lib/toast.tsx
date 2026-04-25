"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckOutlined, CloseOutlined, DownOutlined, ExclamationOutlined, UpOutlined } from "@ant-design/icons";
import { toast as sonnerToast } from "sonner";

type ToastType = "default" | "success" | "error" | "warning";

type ToastOptions = {
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
};

function ToastCard({
  id,
  type,
  title,
  description,
  action,
}: {
  id: string | number;
  type: ToastType;
  title: string;
  description?: string;
  action?: ToastOptions["action"];
}) {
  const hasDetails = Boolean(description || action);
  const [expanded, setExpanded] = useState(hasDetails);

  useEffect(() => {
    if (!hasDetails) return;
    const timer = window.setTimeout(() => {
      setExpanded(false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [hasDetails, id]);

  const typeIcon = useMemo(() => {
    switch (type) {
      case "success":
        return <CheckOutlined />;
      case "error":
        return <CloseOutlined />;
      case "warning":
        return <ExclamationOutlined />;
      default:
        return <CheckOutlined />;
    }
  }, [type]);

  return (
    <div className="niche-toast-card" data-type={type}>
      <div className="niche-toast-card__header">
        <div className="niche-toast-card__title-wrap">
          <span className="niche-toast-card__badge" aria-hidden="true">{typeIcon}</span>
          <span className="niche-toast-card__title">{title}</span>
        </div>
        {hasDetails ? (
          <button
            type="button"
            className="niche-toast-card__toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "收起详情" : "展开详情"}
            title={expanded ? "收起详情" : "展开详情"}
          >
            {expanded ? <UpOutlined /> : <DownOutlined />}
          </button>
        ) : null}
      </div>

      {hasDetails && expanded ? (
        <div className="niche-toast-card__details">
          {description ? <div className="niche-toast-card__description">{description}</div> : null}
          {action ? (
            <button
              type="button"
              className="niche-toast-card__action"
              onClick={() => {
                sonnerToast.dismiss(id);
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function showToast(type: ToastType, title: string, options?: ToastOptions) {
  return sonnerToast.custom(
    (id) => (
      <ToastCard
        id={id}
        type={type}
        title={title}
        description={options?.description}
        action={options?.action}
      />
    ),
    {
      duration: options?.duration ?? 3200,
      className: "niche-toast-shell",
    }
  );
}

type ToastFn = ((title: string, options?: ToastOptions) => string | number) & {
  success: (title: string, options?: ToastOptions) => string | number;
  error: (title: string, options?: ToastOptions) => string | number;
  warning: (title: string, options?: ToastOptions) => string | number;
  dismiss: (id?: string | number) => void;
};

export const toast: ToastFn = Object.assign(
  (title: string, options?: ToastOptions) => showToast("default", title, options),
  {
    success: (title: string, options?: ToastOptions) => showToast("success", title, options),
    error: (title: string, options?: ToastOptions) => showToast("error", title, options),
    warning: (title: string, options?: ToastOptions) => showToast("warning", title, options),
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  }
);
