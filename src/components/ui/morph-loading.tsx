"use client";

import { cn } from "@/lib/utils";

interface UniqueLoadingProps {
  variant?: "morph";
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Four squares that drift apart, round off and come back together (the morph-0..3 keyframes in globals.css).
 * Each square travels up to 40px from the centre, so "md" (96px) holds the whole motion. Under
 * prefers-reduced-motion the squares only pulse (globals.css).
 */
export default function UniqueLoading({ variant = "morph", size = "md", className }: UniqueLoadingProps) {
  const containerSizes = {
    sm: "w-16 h-16",
    md: "w-24 h-24",
    lg: "w-32 h-32",
  };

  if (variant === "morph") {
    return (
      <div className={cn("morph-loader relative", containerSizes[size], className)}>
        <div className="absolute inset-0 flex items-center justify-center">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute h-4 w-4 bg-fg"
              style={{
                animation: `morph-${i} 2s infinite ease-in-out`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}
