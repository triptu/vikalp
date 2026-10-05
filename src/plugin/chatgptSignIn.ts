import { Modal, Notice, Setting, type App } from "obsidian";
import type { AiClient } from "../ai/aiClient";

/**
 * Opens the ChatGPT sign-in page in the browser and waits for it to come back.
 * Resolves true once the token is saved, false if the writer cancelled or it failed.
 */
export async function signInWithChatGPT(app: App, ai: AiClient): Promise<boolean> {
	const abort = new AbortController();
	const modal = new SignInModal(app, () => abort.abort());
	modal.open();
	try {
		await ai.signInWithChatGPT({
			signal: abort.signal,
			notify: (event) => {
				if (event.type === "auth_url") modal.showSignInPage(event.url);
			},
			prompt: (prompt) => (prompt.type === "manual_code" ? modal.waitForPastedAddress(prompt.signal) : Promise.reject(new Error(`Unexpected sign-in step: ${prompt.type}`))),
		});
		new Notice("Signed in with ChatGPT.");
		return true;
	} catch (error) {
		if (!abort.signal.aborted) new Notice(`ChatGPT sign-in failed. ${error instanceof Error ? error.message : String(error)}`, 10000);
		return false;
	} finally {
		modal.finish();
	}
}

/** Stays open while the writer signs in. Closing it cancels the sign-in. */
class SignInModal extends Modal {
	private signInUrl: string | null = null;
	private submitPasted: ((address: string) => void) | null = null;
	private finished = false;

	constructor(
		app: App,
		private readonly cancel: () => void,
	) {
		super(app);
	}

	override onOpen() {
		this.titleEl.setText("Sign in with ChatGPT");
		this.contentEl.createEl("p", { text: "Finish signing in in your browser. This window closes by itself when you're done." });
		let pasted = "";
		new Setting(this.contentEl)
			.setName("Browser didn't come back?")
			.setDesc("Paste the address it ends on.")
			.addText((text) => text.setPlaceholder("http://127.0.0.1:1455/auth/callback?…").onChange((value) => (pasted = value.trim())))
			.addButton((button) => button.setButtonText("Continue").onClick(() => pasted && this.submitPasted?.(pasted)));
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Open the sign-in page again").onClick(() => this.signInUrl && window.open(this.signInUrl)))
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
	}

	showSignInPage(url: string) {
		this.signInUrl = url;
		window.open(url);
	}

	waitForPastedAddress(signal: AbortSignal | undefined): Promise<string> {
		return new Promise((resolve, reject) => {
			this.submitPasted = resolve;
			signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
		});
	}

	/** Closes the modal without cancelling, once sign-in has ended either way. */
	finish() {
		this.finished = true;
		this.close();
	}

	override onClose() {
		this.contentEl.empty();
		if (!this.finished) this.cancel();
	}
}
