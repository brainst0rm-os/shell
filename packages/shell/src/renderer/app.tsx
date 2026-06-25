import { Dashboard } from "./dashboard";
import { ConfirmHost } from "./ui/confirm";
import "./ui/confirm.css";
import { IconPickerHost } from "./ui/pick-icon";
import { ToastHost } from "./ui/toast-host";
import "./ui/toasts.css";
import { useVault } from "./vault-context";
import { Welcome } from "./welcome/welcome";

export function App() {
	const { loading, current } = useVault();
	return (
		<>
			{loading ? <div className="loading" /> : current ? <Dashboard /> : <Welcome />}
			<ToastHost />
			<ConfirmHost />
			<IconPickerHost />
		</>
	);
}
