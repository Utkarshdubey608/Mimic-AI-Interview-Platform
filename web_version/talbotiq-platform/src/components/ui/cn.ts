import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Class composer. `clsx` resolves conditionals, `twMerge` resolves Tailwind
 * conflicts so a caller's `className` genuinely overrides a component's default
 * rather than depending on stylesheet order.
 *
 * Lives in its own module because almost every primitive needs it, and importing
 * it from the barrel would make the barrel a cycle.
 */
export const cn = (...c: Parameters<typeof clsx>) => twMerge(clsx(c))
