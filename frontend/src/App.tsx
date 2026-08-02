import { useEffect, useState } from "react";

function App() {
  const [backendMsg, setBackendMsg] = useState<string>("connecting…");

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((data) => setBackendMsg(data.message))
      .catch(() => setBackendMsg("backend unreachable"));
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold">⚡ KSPDB Fault Localization</h1>
      <p className="text-lg text-gray-400">Frontend is running.</p>
      <p className="text-sm text-gray-500">
        Backend says: <span className="text-green-400">{backendMsg}</span>
      </p>
    </div>
  );
}

export default App;
