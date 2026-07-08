# Kubernetes — minikube deployment

## Prerequisites

The following must already be running in the cluster (deployed from the Rust workspace):
- Postgres in the `databases` namespace (`postgres-service.databases.svc.cluster.local`)
- Redis in the `databases` namespace (`redis-service.databases.svc.cluster.local`)
- RabbitMQ in the `rabbitmq` namespace (`rabbitmq-service.rabbitmq.svc.cluster.local`)

## Deploy

### 1. Build the image inside minikube's Docker daemon

```bash
eval $(minikube docker-env)
docker build -t nestjs-url-shortener:latest .
```

`eval $(minikube docker-env)` points your shell's Docker client at minikube's internal daemon. The image is then visible to the cluster without a registry. Run this in the repo root.

### 2. Apply the manifests

```bash
kubectl apply -f k8s/
```

This creates the namespace, ConfigMap, Secret, Deployment, Service, and ServiceMonitor in one pass. The Deployment's initContainer will create the `url_shortener` database in Postgres if it doesn't already exist.

### 3. Verify

```bash
# Watch the rollout
kubectl rollout status deployment/url-shortener -n url-shortener

# Check pods
kubectl get pods -n url-shortener

# Tail logs
kubectl logs -f deployment/url-shortener -n url-shortener
```

### 4. Access the service

```bash
minikube service url-shortener-service -n url-shortener
```

This opens a tunnel to the NodePort and prints the URL. Alternatively, the service is on port `30080` on the minikube node IP:

```bash
curl http://$(minikube ip):30080/health
```

## Files

| File | Purpose |
|---|---|
| `namespace.yaml` | `url-shortener` namespace |
| `app-config.yaml` | ConfigMap — non-sensitive config, cluster DNS names for infra |
| `secret.yaml` | Secret — Postgres and RabbitMQ credentials (dev values) |
| `app-deployment.yaml` | Deployment — initContainer creates DB, main container runs the app |
| `app-service.yaml` | NodePort Service on port 30080 |
| `service-monitor.yaml` | Prometheus ServiceMonitor (requires kube-prometheus-stack) |

## Notes

- `imagePullPolicy: Never` is set on the app container. The image must be built inside minikube's daemon (step 1 above) — pulling from a registry will not work with this setting.
- `secret.yaml` contains hardcoded dev credentials and is committed for convenience. Replace with ExternalSecrets or sealed-secrets before deploying anywhere real.
- `service-monitor.yaml` requires the `monitoring.coreos.com/v1` CRD (installed by kube-prometheus-stack). Apply it separately if the CRD isn't present: `kubectl apply -f k8s/ --ignore-not-found` won't help here — just skip that file if Prometheus isn't installed.
