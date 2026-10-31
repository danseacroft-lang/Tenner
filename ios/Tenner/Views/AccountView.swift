import SwiftUI

/// Sign in (or create an account) with the same email and password as tenner.stream; once in, sync and sign out
struct AccountView: View {
    @Environment(Account.self) private var account
    @State private var mode = Mode.signIn
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var message: String?
    @State private var note: String?
    @State private var confirmSignOut = false
    @FocusState private var focus: Field?

    enum Mode { case signIn, create }
    enum Field { case name, email, password }

    var body: some View {
        Form {
            if account.signedIn { signedIn } else { signedOut }
        }
        .navigationTitle("Your account")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: signed in

    @ViewBuilder private var signedIn: some View {
        Section {
            VStack(spacing: 10) {
                Avatar(user: account.user, size: 84)
                Text(account.user?.name ?? "You").font(.title2.bold())
                if let e = account.user?.email { Text(e).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity).padding(.vertical, 8)
        }
        Section {
            Button {
                Task { await account.sync() }
            } label: {
                HStack {
                    Text("Sync now")
                    Spacer()
                    if account.syncing { ProgressView() }
                    else if let d = account.lastSynced { Text(d.formatted(.relative(presentation: .named))).foregroundStyle(.secondary) }
                }
            }
        } footer: {
            Text("Your Watchlist, where you're up to, your services and settings are the same here and on tenner.stream.")
        }
        Section {
            Link("Manage passkeys, Google and devices", destination: URL(string: "https://tenner.stream/account.html")!)
        }
        Section {
            Button("Sign out", role: .destructive) { confirmSignOut = true }
                .confirmationDialog("Sign out of Tenner?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                    Button("Sign out and keep my Watchlist here") { Task { await account.signOut(clearThisDevice: false) } }
                    Button("Sign out and clear this iPhone", role: .destructive) { Task { await account.signOut(clearThisDevice: true) } }
                }
        }
    }

    // MARK: signed out

    @ViewBuilder private var signedOut: some View {
        Section {
            Picker("", selection: $mode) {
                Text("Sign in").tag(Mode.signIn)
                Text("Create account").tag(Mode.create)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
        Section {
            if mode == .create {
                TextField("Your name", text: $name)
                    .textContentType(.name).focused($focus, equals: .name).submitLabel(.next)
                    .onSubmit { focus = .email }
            }
            TextField("Email", text: $email)
                .textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused($focus, equals: .email).submitLabel(.next)
                .onSubmit { focus = .password }
            SecureField("Password", text: $password)
                .textContentType(mode == .create ? .newPassword : .password)
                .focused($focus, equals: .password).submitLabel(.go)
                .onSubmit { Task { await go() } }
        } footer: {
            if let message { Text(message).foregroundStyle(.red) }
            else if let note { Text(note) }
            else { Text("The same account as tenner.stream. Your password is scrambled on this iPhone before it's sent.") }
        }
        Section {
            Button {
                Task { await go() }
            } label: {
                HStack {
                    Spacer()
                    if busy { ProgressView() } else { Text(mode == .create ? "Create account" : "Sign in").fontWeight(.semibold) }
                    Spacer()
                }
            }
            .disabled(busy || email.isEmpty || password.count < (mode == .create ? 8 : 1) || (mode == .create && name.isEmpty))
            if mode == .signIn {
                Button("Forgotten your password?") { Task { await forgot() } }
                    .disabled(busy || email.isEmpty)
            }
        }
        Section {
        } footer: {
            Text("Signed up with a passkey or Google? Those come to the app soon. Until then, add a password to your account on tenner.stream.")
        }
    }

    private func go() async {
        busy = true; message = nil; note = nil
        defer { busy = false }
        do {
            if mode == .create { try await account.create(name: name, email: email, password: password) }
            else { try await account.signIn(email: email, password: password) }
            password = ""
        } catch {
            message = error.localizedDescription
        }
    }

    private func forgot() async {
        busy = true
        defer { busy = false }
        do {
            try await account.forgot(email: email)
            message = nil; password = ""
            note = "If there's an account for \(email), a link to set a new password is on its way."
        } catch { message = error.localizedDescription }
    }
}
