#!/usr/bin/env node
// Thin proxy — delegates everything to @i18n-doctor/cli
import { runCli } from "@i18n-doctor/cli";

const code = await runCli(process.argv);
process.exitCode = code;
