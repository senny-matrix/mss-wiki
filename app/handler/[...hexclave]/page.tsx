import { HexclaveHandler } from "@hexclave/next";
import { hexclaveServerApp } from "@/hexclave/server";

export default function Handler(props: unknown) {
  return <HexclaveHandler fullPage app={hexclaveServerApp} routeProps={props} />;
}
