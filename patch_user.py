import os

with open('src/Repository/UserRepository.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = """    public function create(string $name, string $email, string $passwordHash, string $role = 'Customer'): array
    {
        $this->db->query(
            'INSERT INTO Users (name, email, password_hash, role, is_verified)
             VALUES (:name, :email, :password_hash, :role, false)',
            [
                ':name'          => $name,
                ':email'         => $email,
                ':password_hash' => $passwordHash,
                ':role'          => $role,
            ]
        );"""

replace = """    public function create(string $name, string $email, string $passwordHash, string $role = 'Customer', ?string $accountType = null): array
    {
        $this->db->query(
            'INSERT INTO Users (name, email, password_hash, role, is_verified, account_type)
             VALUES (:name, :email, :password_hash, :role, false, :account_type)',
            [
                ':name'          => $name,
                ':email'         => $email,
                ':password_hash' => $passwordHash,
                ':role'          => $role,
                ':account_type'  => $accountType,
            ]
        );"""

if find in content:
    content = content.replace(find, replace)
    with open('src/Repository/UserRepository.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched UserRepository")
else:
    print("Could not find UserRepository create")
