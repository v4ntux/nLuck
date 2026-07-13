from setuptools import setup, find_packages

setup(
    name="nbet",
    version="0.1.0",
    description="nFunBot - mini-casino Telegram bot (MVP)",
    packages=find_packages(),
    install_requires=[
        "aiogram>=3.7.0",
        "SQLAlchemy>=2.0.36",
        "aiohttp>=3.10.5",
        "python-dotenv>=1.0.1",
        "aiosqlite>=0.20.0",
    ],
)

