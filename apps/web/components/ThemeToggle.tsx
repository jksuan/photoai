"use client";

import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  // 等待客户端挂载后再渲染，避免 hydration 不匹配
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === "dark";

  // 如果还没挂载，返回预占位，保持结构但不显示激活状态
  if (!mounted) {
    return (
      <div className="flex items-center gap-2">
        <Sun className="h-5 w-5" />
        <Switch className="data-[state=unchecked]:bg-input" />
        <Moon className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Sun className={`h-5 w-5 ${!isDark ? "text-pink-500" : ""}`} />
      <Switch
        className="data-[state=checked]:bg-pink-500 data-[state=unchecked]:bg-input"
        checked={isDark}
        onCheckedChange={() => setTheme(isDark ? "light" : "dark")}
      />
      <Moon className={`h-5 w-5 ${isDark ? "text-pink-500" : ""}`} />
    </div>
  );
}
