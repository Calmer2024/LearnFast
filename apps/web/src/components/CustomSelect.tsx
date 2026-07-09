import { CaretDown, Check } from "@phosphor-icons/react";
import {
  CSSProperties,
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type CustomSelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type CustomSelectProps<T extends string> = {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

export function CustomSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  disabled = false,
  placeholder = "请选择",
}: CustomSelectProps<T>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 280,
    placement: "bottom",
  });

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const firstEnabledIndex = useMemo(
    () => options.findIndex((option) => !option.disabled),
    [options],
  );
  const menuId = `${id}-listbox`;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportMargin = 10;
    const menuGap = 6;
    const minHeight = 140;
    const maxHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom - viewportMargin;
    const spaceAbove = rect.top - viewportMargin;
    const placeAbove = spaceBelow < minHeight && spaceAbove > spaceBelow;
    const availableSpace = placeAbove ? spaceAbove : spaceBelow;
    const height = Math.max(96, Math.min(maxHeight, availableSpace - menuGap));
    const width = Math.max(rect.width, 148);
    const left = Math.min(
      Math.max(viewportMargin, rect.left),
      Math.max(viewportMargin, window.innerWidth - width - viewportMargin),
    );
    const top = placeAbove ? rect.top - menuGap - height : rect.bottom + menuGap;

    setPosition({
      left,
      top: Math.max(viewportMargin, top),
      width,
      maxHeight: height,
      placement: placeAbove ? "top" : "bottom",
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const nextIndex =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabledIndex;
    setActiveIndex(nextIndex);
  }, [firstEnabledIndex, open, options, selectedIndex]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updatePosition]);

  const selectOption = (option: CustomSelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveActive = (direction: 1 | -1) => {
    if (firstEnabledIndex < 0) return;
    let next = activeIndex >= 0 ? activeIndex : firstEnabledIndex;
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
        return;
      }
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      let lastEnabled = -1;
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (!options[index].disabled) {
          lastEnabled = index;
          break;
        }
      }
      setActiveIndex(lastEnabled);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const option = options[activeIndex];
      if (option) selectOption(option);
    }
  };

  const menuStyle: CSSProperties = {
    left: position.left,
    maxHeight: position.maxHeight,
    top: position.top,
    width: position.width,
  };
  const activeOptionId = activeIndex >= 0 ? `${menuId}-option-${activeIndex}` : undefined;

  return (
    <div className={`custom-select ${className ?? ""}`.trim()}>
      <button
        ref={triggerRef}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="custom-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <span className="custom-select-value">{selectedOption?.label ?? placeholder}</span>
        <CaretDown className="custom-select-caret" size={15} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="custom-select-menu"
            data-placement={position.placement}
            id={menuId}
            role="listbox"
            style={menuStyle}
          >
            {options.length === 0 && <div className="custom-select-empty">暂无选项</div>}
            {options.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <button
                  aria-disabled={option.disabled || undefined}
                  aria-selected={selected}
                  className={`custom-select-option ${selected ? "selected" : ""} ${
                    active ? "active" : ""
                  }`.trim()}
                  disabled={option.disabled}
                  id={`${menuId}-option-${index}`}
                  key={option.value}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span>{option.label}</span>
                  {selected && <Check className="custom-select-check" size={14} weight="bold" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
