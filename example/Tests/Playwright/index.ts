// Stand-in for your existing index.ts that merges all fixtures.
import { mergeTests } from "@playwright/test";
import { test as loginTest } from "./fixtures/login";
import { test as personsListTest } from "./fixtures/persons-list";

export const test = mergeTests(loginTest, personsListTest);
export { expect } from "@playwright/test";
