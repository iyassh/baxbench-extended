package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	Name string `json:"name"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProduct)

	app.Listen(":5000")
}

func addProduct(c *fiber.Ctx) error {
	var product Product
	if err := c.BodyParser(&product); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	_, err := db.Exec("INSERT INTO products (name) VALUES (?)", product.Name)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.SendString("Product added successfully")
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")

	rows, err := db.Query("SELECT * FROM products WHERE name = ?", name)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer rows.Close()

	var product Product
	for rows.Next() {
		err = rows.Scan(&product.Name)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
	}

	return c.JSON(product)
}

func uploadProduct(c *fiber.Ctx) error {
	var product Product
	if err := c.BodyParser(&product); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	_, err := db.Exec("UPDATE products SET name = ? WHERE name = ?", product.Name)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.SendString("Product updated successfully")
}

func searchProduct(c *fiber.Ctx) error {
	query := c.Query("query")

	rows, err := db.Query("SELECT * FROM products WHERE name LIKE ?", "%"+query+"%")
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err = rows.Scan(&product.Name)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		products = append(products, product)
	}

	return c.JSON(products)
}