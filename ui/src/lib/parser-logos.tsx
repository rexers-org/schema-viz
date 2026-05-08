import React from "react"

type Props = { size?: number; className?: string }

export function PrismaLogo({ size = 18, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <polygon
        points="12,2.5 21.5,20 2.5,20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <line x1="12" y1="2.5" x2="12" y2="20" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="11" x2="7" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.45" />
    </svg>
  )
}

export function LaravelLogo({ size = 18, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* Flat-top hexagon */}
      <polygon
        points="12,2 20.5,6.5 20.5,15.5 12,20 3.5,15.5 3.5,6.5"
        stroke="#FF2D20"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* L bracket */}
      <path
        d="M8.5 7.5v5.5h6"
        stroke="#FF2D20"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PostgreSQLLogo({ size = 18, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* Head */}
      <ellipse cx="11.5" cy="9.5" rx="5" ry="5" stroke="#5B9BD5" strokeWidth="1.5" />
      {/* Left ear */}
      <path
        d="M7.5 5.5C6 4 4 4.5 4 7s2.5 3.5 6 2.5"
        stroke="#5B9BD5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Trunk */}
      <path
        d="M16 12.5c2 .5 3.5 1.5 3.5 3.5s-1.5 3-2 4.5"
        stroke="#5B9BD5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Left leg / body */}
      <path d="M7 14.5c-.5 2.5-.5 4.5 0 6" stroke="#5B9BD5" strokeWidth="1.5" strokeLinecap="round" />
      {/* Right leg / body */}
      <path d="M15 14.5c.5 2.5.5 4.5 0 6" stroke="#5B9BD5" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function MySQLLogo({ size = 18, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* Dolphin body arc (back) */}
      <path
        d="M3.5 14C3.5 8.5 7.5 4 13 4c3.5 0 6.5 1.8 7.8 5"
        stroke="#4479A1"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Dorsal fin */}
      <path d="M13 4c-.5 3.5 1.5 5.5 3.5 4.5" stroke="#4479A1" strokeWidth="1.5" strokeLinecap="round" />
      {/* Tail fluke */}
      <path
        d="M20.8 9l-3 2.5 3.7 2.2"
        stroke="#4479A1"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Belly / underside */}
      <path
        d="M3.5 14c1 4 5 6.5 9.5 6.5 3.5 0 6.5-1.5 8-4"
        stroke="#4479A1"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function JSONLogo({ size = 18, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* Left brace */}
      <path
        d="M9 4C6.5 4 5.5 5.5 5.5 7.5v2C5.5 10.5 4 12 4 12s1.5 1.5 1.5 2.5v2C5.5 18.5 6.5 20 9 20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Right brace */}
      <path
        d="M15 4C17.5 4 18.5 5.5 18.5 7.5v2c0 1 1.5 2.5 1.5 2.5s-1.5 1.5-1.5 2.5v2C18.5 18.5 17.5 20 15 20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

type ParserInfo = {
  Logo: React.FC<Props>
  label: string
  color: string
}

export function TypeORMLogo({ size = 18, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* Outer ring */}
      <ellipse cx="12" cy="12" rx="9" ry="9" stroke="currentColor" strokeWidth="1.5" />
      {/* T letter */}
      <path
        d="M8 8.5h8M12 8.5v7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DrizzleLogo({ size = 18, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      {/* Three stacked tilted lines — Drizzle's drip motif */}
      <path d="M5 7h14" stroke="#C5F74F" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 12h10" stroke="#C5F74F" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 17h6" stroke="#C5F74F" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const PARSER_MAP: Record<string, ParserInfo> = {
  Prisma: { Logo: PrismaLogo, label: "Prisma", color: "text-gray-300" },
  "Laravel migrations": { Logo: LaravelLogo, label: "Laravel", color: "text-[#FF2D20]/90" },
  JSON: { Logo: JSONLogo, label: "JSON", color: "text-yellow-400/80" },
  "postgresql-db": { Logo: PostgreSQLLogo, label: "PostgreSQL", color: "text-[#5B9BD5]" },
  "mysql-db": { Logo: MySQLLogo, label: "MySQL", color: "text-[#4479A1]" },
  TypeORM: { Logo: TypeORMLogo, label: "TypeORM", color: "text-[#E83524]/90" },
  "Drizzle ORM": { Logo: DrizzleLogo, label: "Drizzle", color: "text-[#C5F74F]/90" },
}

export function parser_info(parserName: string): ParserInfo {
  return PARSER_MAP[parserName] ?? { Logo: JSONLogo, label: parserName, color: "text-gray-400" }
}
