import os

with open('src/Controller/AuthController.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = """        $name     = trim((string) ($body['name']     ?? ''));
        $email    = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if ($name === '' || $email === '' || $password === '') {
            Response::error('name, email and password are required.', 422);
        }"""

replace = """        $name     = trim((string) ($body['name']     ?? ''));
        $email    = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');
        $accountType = trim((string) ($body['account_type'] ?? ''));

        if ($name === '' || $email === '' || $password === '' || $accountType === '') {
            Response::error('name, email, password, and account_type are required.', 422);
        }
        
        if (!in_array($accountType, ['Student', 'Faculty'], true)) {
            Response::error('Account type must be either Student or Faculty.', 422);
        }"""

if find in content:
    content = content.replace(find, replace)
    print("Patched AuthController validation")
else:
    print("Could not find validation in AuthController")

find2 = """            // Role is fixed: the request body never chooses it.
            $user = $this->users->create($name, $email, password_hash($password, PASSWORD_DEFAULT), 'Customer');"""

replace2 = """            // Role is fixed: the request body never chooses it.
            $user = $this->users->create($name, $email, password_hash($password, PASSWORD_DEFAULT), 'Customer', $accountType);"""

if find2 in content:
    content = content.replace(find2, replace2)
    with open('src/Controller/AuthController.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched AuthController create call")
else:
    print("Could not find create call in AuthController")
