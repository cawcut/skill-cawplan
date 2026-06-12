import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = resolve(root, "config/products.json");
const backupPath = resolve(root, ".products.pack-backup.json");

function readProducts() {
  return JSON.parse(readFileSync(productsPath, "utf8"));
}

function writeProducts(data) {
  writeFileSync(productsPath, `${JSON.stringify(data, null, 2)}\n`);
}

function prepack() {
  if (existsSync(backupPath)) {
    throw new Error(`Refusing to overwrite existing pack backup: ${backupPath}`);
  }

  const data = readProducts();
  const product = data.products?.cawplan;
  const prod = product?.env?.prd;

  if (!product || !prod) {
    throw new Error("products.json must contain products.cawplan.env.prd");
  }

  copyFileSync(productsPath, backupPath);
  writeProducts({
    ...data,
    products: {
      ...data.products,
      cawplan: {
        ...product,
        defaultEnv: "prd",
        env: {
          prd: prod,
        },
      },
    },
  });
}

function postpack() {
  if (!existsSync(backupPath)) return;

  copyFileSync(backupPath, productsPath);
  rmSync(backupPath);
}

const command = process.argv[2];

if (command === "prepack") {
  prepack();
} else if (command === "postpack") {
  postpack();
} else {
  throw new Error("Usage: node scripts/pack-public-config.mjs <prepack|postpack>");
}
