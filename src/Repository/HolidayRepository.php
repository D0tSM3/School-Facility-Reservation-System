<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

class HolidayRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function findAll(): array
    {
        $stmt = $this->db->query("SELECT * FROM Holidays ORDER BY holiday_date ASC");
        return $stmt->fetchAll();
    }

    public function create(string $date, string $name, string $type): void
    {
        $this->db->query(
            "INSERT INTO Holidays (holiday_date, name, type) VALUES (:date, :name, :type)",
            [
                ':date' => $date,
                ':name' => $name,
                ':type' => $type
            ]
        );
    }

    public function delete(string $date): void
    {
        $this->db->query(
            "DELETE FROM Holidays WHERE holiday_date = :date",
            [':date' => $date]
        );
    }
}
