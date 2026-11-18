import NextLink from "next/link";
import type { ComponentProps } from "react";
import { pagePin } from "@/lib/ui/pin";
import { withRev } from "@/lib/ui/pin-rules";

/**
 * next/link for server-rendered screens: on a page pinned to an earlier revision, an internal
 * href keeps `?rev=N`, so following it never lands silently on the latest data (D14). An href
 * that already names a revision (a history link) is left alone.
 */
export default function Link({ href, ...rest }: ComponentProps<typeof NextLink>) {
  return <NextLink href={typeof href === "string" ? withRev(href, pagePin()) : href} {...rest} />;
}
