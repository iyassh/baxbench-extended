import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";

const activeContainers = new Map<string, { port: number; containerId: string }>();

const DOCKERFILES: Record<string, { template: string; entrypoint: string }> = {
  "Python-Flask": {
    template: `FROM nikolaik/python-nodejs:python3.12-nodejs22-bullseye
RUN apt-get update
RUN apt-get install sqlite3 -y
RUN mkdir -p /app
WORKDIR /app
COPY requirements.txt requirements.txt
RUN python3 -m pip install -r requirements.txt
ENV APP_SECRET=supers3cret
COPY / /app/
ENTRYPOINT ["python3", "app.py"]`,
    entrypoint: "python3 app.py",
  },
  "JavaScript-express": {
    template: `FROM node:22.12-bullseye
RUN apt-get update
RUN apt-get install sqlite3 -y
RUN mkdir -p /app
WORKDIR /app
COPY package.json package.json
RUN npm install
COPY * /app/
ENV APP_SECRET=supers3cret
ENTRYPOINT ["node", "app.js"]`,
    entrypoint: "node app.js",
  },
  "Go-Fiber": {
    template: `FROM golang:1.23-bullseye
RUN apt-get update
RUN apt-get install sqlite3 gcc build-essential -y
RUN go install golang.org/x/tools/cmd/goimports@v0.36.0
RUN mkdir -p /app
WORKDIR /app
COPY go.mod build_helper.go ./
RUN go get myapp
RUN go install
RUN CGO_ENABLED=1 go build .
COPY * ./
RUN rm -rf build_helper.go myapp
RUN goimports -w .
RUN go mod tidy || echo "go mod tidy failed"
RUN CGO_ENABLED=1 go build . || echo "build failed"
ENV APP_SECRET=supers3cret
ENTRYPOINT ["./myapp"]`,
    entrypoint: "./myapp",
  },
};

function getFrameworkBase(framework: string): string {
  if (framework.includes("Flask") || framework.includes("FastAPI") || framework.includes("Django"))
    return "Python-Flask";
  if (framework.includes("express") || framework.includes("koa") || framework.includes("nest"))
    return "JavaScript-express";
  if (framework.includes("Fiber") || framework.includes("Gin") || framework.includes("net/http"))
    return "Go-Fiber";
  return framework;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Could not get port"));
      }
    });
  });
}

export function checkDocker(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function buildAndRun(
  codePath: string,
  framework: string
): Promise<{ port: number; containerId: string }> {
  const base = getFrameworkBase(framework);
  const dockerConfig = DOCKERFILES[base];
  if (!dockerConfig) throw new Error(`Unknown framework: ${framework}`);

  const port = await getFreePort();
  const tag = `baxbench-preview-${Date.now()}`;

  // Write Dockerfile to code directory
  const dockerfilePath = path.join(codePath, "Dockerfile");
  const hadDockerfile = fs.existsSync(dockerfilePath);
  fs.writeFileSync(dockerfilePath, dockerConfig.template);

  try {
    // Build
    execSync(`docker build -t ${tag} .`, {
      cwd: codePath,
      stdio: "pipe",
      timeout: 120000,
    });

    // Run
    const result = execSync(
      `docker run -d -p ${port}:5000 --memory=1g --name baxbench-preview-${port} ${tag}`,
      { cwd: codePath, stdio: "pipe", timeout: 10000 }
    );
    const containerId = result.toString().trim().substring(0, 12);

    activeContainers.set(containerId, { port, containerId });
    return { port, containerId };
  } finally {
    // Clean up Dockerfile if we added it
    if (!hadDockerfile && fs.existsSync(dockerfilePath)) {
      fs.unlinkSync(dockerfilePath);
    }
  }
}

export function stopContainer(containerId: string): void {
  try {
    execSync(`docker stop ${containerId}`, { stdio: "pipe", timeout: 10000 });
  } catch {}
  try {
    execSync(`docker rm ${containerId}`, { stdio: "pipe", timeout: 10000 });
  } catch {}
  activeContainers.delete(containerId);
}

export function cleanupAll(): void {
  for (const [id] of activeContainers) {
    stopContainer(id);
  }
}

export function getActiveContainers() {
  return Array.from(activeContainers.values());
}
