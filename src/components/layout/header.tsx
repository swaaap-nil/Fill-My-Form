import { ThemeSwitch } from "~/components/common/theme";

export const Header = () => {
  return (
    <header className="flex items-center justify-center gap-2">
      <ThemeSwitch />
    </header>
  );
};
