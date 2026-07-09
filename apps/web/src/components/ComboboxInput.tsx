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

type ComboboxInputProps = {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

export function ComboboxInput({ value, options, onChange, placeholder }: ComboboxInputProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
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

  const filteredOptions = useMemo(() => {
    const seen = new Set<string>();
    const uniqueOptions = options.filter((option) => {
      if (seen.has(option)) return false;
      seen.add(option);
      return true;
    });
    const query = value.trim().toLowerCase();
    if (!query) return uniqueOptions;
    return uniqueOptions.filter((option) => option.toLowerCase().includes(query));
  }, [options, value]);
  const menuId = `${id}-suggestions`;

  const updatePosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    const rect = input.getBoundingClientRect();
    const viewportMargin = 10;
    const menuGap = 6;
    const minHeight = 140;
    const maxHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom - viewportMargin;
    const spaceAbove = rect.top - viewportMargin;
    const placeAbove = spaceBelow < minHeight && spaceAbove > spaceBelow;
    const availableSpace = placeAbove ? spaceAbove : spaceBelow;
    const height = Math.max(96, Math.min(maxHeight, availableSpace - menuGap));
    const width = Math.max(rect.width, 180);
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
    setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
  }, [filteredOptions, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.focus();
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

  const chooseOption = (option: string) => {
    onChange(option);
    setOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const moveActive = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    setActiveIndex((current) => {
      const base = current >= 0 ? current : 0;
      return (base + direction + filteredOptions.length) % filteredOptions.length;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      chooseOption(filteredOptions[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
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
    <div ref={rootRef} className={`custom-combobox ${open ? "open" : ""}`.trim()}>
      <input
        ref={inputRef}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-autocomplete="list"
        aria-controls={menuId}
        aria-expanded={open}
        className="custom-combobox-input"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        value={value}
      />
      <button
        aria-label="展开模型建议"
        className="custom-combobox-toggle"
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next) window.requestAnimationFrame(() => inputRef.current?.focus());
            return next;
          });
        }}
        onMouseDown={(event) => event.preventDefault()}
        type="button"
      >
        <CaretDown size={15} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="custom-select-menu custom-combobox-menu"
            data-placement={position.placement}
            id={menuId}
            role="listbox"
            style={menuStyle}
          >
            {filteredOptions.length === 0 && (
              <div className="custom-select-empty">可直接输入自定义模型名</div>
            )}
            {filteredOptions.map((option, index) => {
              const selected = option === value;
              const active = index === activeIndex;
              return (
                <button
                  aria-selected={selected}
                  className={`custom-select-option ${selected ? "selected" : ""} ${
                    active ? "active" : ""
                  }`.trim()}
                  id={`${menuId}-option-${index}`}
                  key={option}
                  onClick={() => chooseOption(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
                >
                  <span>{option}</span>
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
