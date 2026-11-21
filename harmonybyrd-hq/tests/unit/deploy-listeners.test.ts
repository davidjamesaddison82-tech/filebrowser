/**
 * The network-exposure checks of the operations scripts (deploy/bin/hq-common.sh), run against a fake
 * `ss`. The first case is the listener list of the founder's Windows (WSL 2) first run, which the
 * earlier check wrongly failed: systemd-resolved's stub on 127.0.0.53%lo and WSL's DNS tunnel on
 * 10.255.255.254 (an address on lo). Every other case must still be reported as exposure.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const common = path.resolve(__dirname, "../../deploy/bin/hq-common.sh");

// `ss -Hlntup` lines: Netid State Recv-Q Send-Q Local Peer [Process]
function run(ssLines: string[], loAddrs: string, script: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hq-ss-"));
  writeFileSync(path.join(dir, "ss.out"), ssLines.join("\n") + "\n");
  // With -u the Netid column is printed; with -t alone (-Hltn) it is not, and there is no process column.
  writeFileSync(
    path.join(dir, "ss"),
    `#!/usr/bin/env bash
case "$1" in
  *u*) cat "${dir}/ss.out";;
  *) awk '$1 == "tcp" {print $2, $3, $4, $5, $6}' "${dir}/ss.out";;
esac
`,
  );
  chmodSync(path.join(dir, "ss"), 0o755);
  return execFileSync("bash", ["-c", `. "${common}"; ${script}`], {
    env: { NODE_ENV: "test", PATH: `${dir}:${process.env.PATH}`, HQ_LO_ADDRS: loAddrs, HQ_OPS_CONF: "/nonexistent", HQ_ETC: dir },
    encoding: "utf8",
  });
}
const exposed = (lines: string[], lo = "127.0.0.1 ::1") => run(lines, lo, "public_listeners").trim();
const loopbackOnly = (lines: string[], port: number) =>
  run(lines, "127.0.0.1 ::1", `if only_loopback_on ${port}; then echo yes; else echo no; fi`).trim();

const hq = 'tcp LISTEN 0 511 127.0.0.1:3210 0.0.0.0:* users:(("node",pid=900,fd=21))';
const pg4 = 'tcp LISTEN 0 200 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=700,fd=6))';
const pg6 = 'tcp LISTEN 0 200 [::1]:5432 [::]:* users:(("postgres",pid=700,fd=7))';
const wslFirstRun = [
  'tcp LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=210,fd=15))',
  'tcp LISTEN 0 4096 127.0.0.54:53 0.0.0.0:* users:(("systemd-resolve",pid=210,fd=17))',
  'tcp LISTEN 0 4096 10.255.255.254:53 0.0.0.0:* users:(("init",pid=8,fd=12))',
  'udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=210,fd=14))',
  'udp UNCONN 0 0 10.255.255.254:53 0.0.0.0:* users:(("init",pid=8,fd=11))',
  hq,
  pg4,
  pg6,
];

describe("network exposure checks (deploy/bin/hq-common.sh)", () => {
  it("the WSL first-run listeners are all confined to the machine when 10.255.255.254 is on lo", () => {
    expect(exposed(wslFirstRun, "127.0.0.1 10.255.255.254 ::1")).toBe("");
    const all = run(wslFirstRun, "127.0.0.1 10.255.255.254 ::1", "classify_listeners");
    expect(all).toContain("CONFINED tcp 127.0.0.53:53 lo systemd-resolve");
    expect(all).toContain("CONFINED tcp 10.255.255.254:53 - init");
    expect(all).toContain("CONFINED udp 10.255.255.254:53 - init");
  });

  it("the same address is exposure when it is NOT on lo (it would then be on a network interface)", () => {
    expect(exposed(wslFirstRun)).toBe("tcp 10.255.255.254:53 init\nudp 10.255.255.254:53 init");
  });

  it("wildcards and real interface addresses are exposure, over TCP and UDP", () => {
    expect(exposed(['tcp LISTEN 0 511 0.0.0.0:3210 0.0.0.0:* users:(("node",pid=1,fd=1))'])).toBe("tcp 0.0.0.0:3210 node");
    expect(exposed(["tcp LISTEN 0 200 [::]:5432 [::]:*"])).toBe("tcp :::5432 ?");
    expect(exposed(["udp UNCONN 0 0 *:5355 *:*"])).toBe("udp *:5355 ?");
    expect(exposed(["tcp LISTEN 0 511 192.168.1.20:3210 0.0.0.0:*"])).toBe("tcp 192.168.1.20:3210 ?");
    expect(exposed(["udp UNCONN 0 0 [fe80::1%eth0]:546 [::]:*"])).toBe("udp fe80::1:546 ?");
    expect(exposed(["tcp LISTEN 0 10 [::ffff:10.0.0.5]:8080 [::]:*"])).toBe("tcp ::ffff:10.0.0.5:8080 ?");
  });

  it("loopback addresses are confined", () => {
    expect(exposed([hq, pg4, pg6, "tcp LISTEN 0 10 [::ffff:127.0.0.1]:9000 [::]:*", "tcp LISTEN 0 10 127.0.0.53%lo:53 0.0.0.0:*"])).toBe("");
  });

  it("an SSH listener on a server is reported, so only the server check can allow it by port", () => {
    expect(exposed(["tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*"])).toBe("tcp 0.0.0.0:22 ?");
  });

  it("HQ's own ports must be loopback-only: every listener exactly 127.0.0.1 or ::1, and at least one", () => {
    expect(loopbackOnly(wslFirstRun, 3210)).toBe("yes");
    expect(loopbackOnly(wslFirstRun, 5432)).toBe("yes");
    expect(loopbackOnly([hq, "tcp LISTEN 0 511 0.0.0.0:3210 0.0.0.0:*"], 3210)).toBe("no");
    expect(loopbackOnly([pg4, "tcp LISTEN 0 200 [::]:5432 [::]:*"], 5432)).toBe("no");
    expect(loopbackOnly(["tcp LISTEN 0 4096 10.255.255.254:3210 0.0.0.0:*"], 3210)).toBe("no");
    expect(loopbackOnly([hq], 5432)).toBe("no"); // nothing listening is not a pass
    expect(loopbackOnly(["tcp LISTEN 0 511 127.0.0.1:32100 0.0.0.0:*"], 3210)).toBe("no"); // another port
  });
});
