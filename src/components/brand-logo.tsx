"use client";

import Image from "next/image";

export function BrandLogo({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <Image
      src={inverse ? "/supplylink-logo-white.svg" : "/supplylink-logo.svg"}
      alt="SupplyLink"
      width={614}
      height={159}
      fetchPriority="high"
      className={className}
    />
  );
}
